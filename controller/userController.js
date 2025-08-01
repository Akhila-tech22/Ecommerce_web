const Category= require('../models/categorySchema');
const Product = require('../models/productSchema');
const Transaction = require('../models/transactionSchema')
const User = require('../models/userSchema')
const nodemailer = require('nodemailer')
const env = require('dotenv').config()
const bcrypt = require('bcrypt');
const { json } = require('express');
const crypto = require('crypto');

// Helper function to generate unique referral code
const generateReferralCode = () => {
    return crypto.randomBytes(4).toString('hex').toUpperCase(); // hexadecimal 
};

const signup = async (req, res) => {
    try {
        const { name, phone, email, password, cPassword, code } = req.body;
        
        // Validate required fields
        if (!name || !phone || !email || !password) {
            return res.render("signup", { message: "All fields are required" });
        }

        if (password !== cPassword) {
            return res.render("signup", { message: "Passwords don't match" });
        }

        const findUser = await User.findOne({ email: email });

        if (findUser) {
            return res.render("signup", { message: "User already exists" });
        }

        // Check if referral code is provided and valid
        let referralOwner = null;
        if (code && code.trim()) {
            referralOwner = await User.findOne({ referalCode: code.trim().toUpperCase() });
            if (!referralOwner) {
                return res.render("signup", { message: "Invalid referral code" });
            }
        }

        const otp = generateOtp();
        console.log("Generated OTP for signup:", otp); // Debug log

        const emailSent = await sendVerificationEmail(email, otp);

        if (!emailSent) {
            console.log("Failed to send OTP email"); // Debug log
            return res.render("signup", { message: "Failed to send OTP. Please check your email and try again." });
        }

        // Store referral owner ID in session if valid code was used
        req.session.userData = { 
            name, 
            phone, 
            email, 
            password,
            referralOwnerId: referralOwner ? referralOwner._id : null
        };
        req.session.userOtp = otp;

        console.log("OTP stored in session:", req.session.userOtp); // Debug log
        console.log("User data stored in session:", req.session.userData); // Debug log

        res.render("verify-otp");  
        console.log("OTP sent successfully", otp);

    } catch (error) {
        console.error("Signup error", error);
        res.render("signup", { message: "An error occurred during signup. Please try again." });
    }
};

// Updated verifyOtp function with transaction recording
const verifyOtp = async (req, res) => {
    try {
        const { otp } = req.body;
        
        console.log("Received OTP:", otp); // Debug log
        console.log("Session OTP:", req.session.userOtp); // Debug log
        
        if (!req.session.userOtp) {
            return res.json({ success: false, message: "OTP session expired" });
        }

        if (!req.session.userData) {
            return res.json({ success: false, message: "User data not found in session" });
        }
        
        if (otp === req.session.userOtp) {
            const userData = req.session.userData;
            const passwordHash = await securePassword(userData.password);
            
            // Generate unique referral code for new user
            let newReferralCode;
            let isCodeUnique = false;
            
            while (!isCodeUnique) {
                newReferralCode = generateReferralCode();
                const existingCode = await User.findOne({ referalCode: newReferralCode });
                if (!existingCode) {
                    isCodeUnique = true;
                }
            }

            // Create new user with referral code
            const saveUserData = new User({
                name: userData.name,
                email: userData.email,
                phone: userData.phone,
                password: passwordHash,
                referalCode: newReferralCode,
                redeemed: false
            });

            await saveUserData.save();

            // If user used a referral code, reward the referral owner
            if (userData.referralOwnerId) {
                const referralOwner = await User.findById(userData.referralOwnerId);
                if (referralOwner) {
                  
                    const oldWalletBalance = referralOwner.wallet;
                    referralOwner.wallet += 100;
                    const newWalletBalance = referralOwner.wallet;
                    
                    // Add new user to referral owner's redeemed users list
                    referralOwner.redeemedUsers.push(saveUserData._id);
                    
                    await referralOwner.save();

                    // Create transaction record for referral reward
                    const transaction = new Transaction({
                        userId: referralOwner._id,
                        amount: 100,
                        transactionType: 'credit',
                        paymentMethod: 'wallet',
                        paymentGateway: 'wallet',
                        status: 'completed',
                        purpose: 'wallet_add',
                        description: `Referral bonus for ${saveUserData.name} joining with code ${referralOwner.referalCode}`,
                        walletBalanceAfter: newWalletBalance,
                        metadata: {
                            referralType: 'signup_bonus',
                            referredUserId: saveUserData._id,
                            referredUserName: saveUserData.name,
                            referralCode: referralOwner.referalCode
                        }
                    });

                    await transaction.save();
                    
                    console.log(`Referral reward processed: ${referralOwner.name} received ₹100 for referring ${saveUserData.name}`);
                }
            }

            // Clear session data
            req.session.userData = null;
            req.session.userOtp = null;

            res.json({ success: true, redirectUrl: "/login" });
            
        } else {
            res.json({ success: false, message: "Invalid OTP" });
        }
    } catch (error) {
        console.error("Error Verifying OTP", error);
        res.status(500).json({ success: false, message: "An error occurred" });
    }
};

const loadHome = async (req, res) => {
    try {
        const user = req.session.user;
        const categories = await Category.find({ isListed: true });
        
        // 1. Get main products (limited to 12)
        let productData = await Product.find({
            isBlocked: false,
            category: { $in: categories.map(category => category._id) },
            'variants.quantity': { $gt: 0 }
        })
        .sort({ createdAt: -1 })
        .limit(12)
        .lean();

        // 2. Get trending products - consider sales, views, and recent purchases
        let trendingProducts = await Product.aggregate([
            {
                $match: {
                    isBlocked: false,
                    category: { $in: categories.map(c => c._id) },
                    'variants.quantity': { $gt: 0 }
                }
            },
            {
                $project: {
                    productName: 1,
                    productImage: 1,
                    salePrice: 1,
                    regularPrice: 1,
                    sold: 1,
                    views: 1,
                    createdAt: 1,
                    // Calculate a trending score (adjust weights as needed)
                    trendingScore: {
                        $add: [
                            { $multiply: ["$sold", 0.5] }, // Sales count more
                            { $multiply: ["$views", 0.3] }, // Views count less
                            { 
                                $multiply: [
                                    { 
                                        $divide: [
                                            { $subtract: [new Date(), "$createdAt"] },
                                            1000 * 60 * 60 * 24 // Convert to days
                                        ] 
                                    },
                                    -0.2 // Newer products get a boost
                                ] 
                            }
                        ]
                    }
                }
            },
            { $sort: { trendingScore: -1 } },
            { $limit: 8 }
        ]);

        console.log('Main Products:', productData.length);
        console.log('Trending Products:', trendingProducts.length);

        if (user) {
            const userData = await User.findOne({ _id: user });
            res.render('home', {
                user: userData,
                products: productData,
                trendingProducts, // Changed from relatedProducts to trendingProducts
                req
            });
        } else {
            res.render('home', {
                products: productData,
                trendingProducts, // Changed from relatedProducts to trendingProducts
                req
            });
        }

    } catch (error) {
        console.error('Home Page Error:', error);
        res.status(500).send('Server Error');
    }
};

const pageNotFound = async (req,res) => {
    try {
        res.render('page-404')
    }catch(error) {
        res.redirect("/pageNotFound")
    }
}

const loadsignup = async (req,res) => {
    try {
       return res.render('signup')
    } catch(error) {
        console.log("loadsignup error:", error.message);
        res.status(500).send("server error");
    }
}

const loadLogin = async (req, res) => {
    try {
        if (!req.session.user) {
            const message = req.session.messages?.[0];
            req.session.messages = []; // Clear message after reading
            res.render('login', { message });
        } else {
            res.redirect('/');
        }
    } catch (error) {
        res.redirect("/pageNotFound");
    }
};

function generateOtp() {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("Generated OTP:", otp); // Debug log
    return otp;
}

async function sendVerificationEmail(email, otp) {
    try {
        console.log("Attempting to send email to:", email);
        console.log("Using email credentials:", process.env.NODEMAILER_EMAIL);
        
        // Create transporter with corrected configuration
       const transporter = nodemailer.createTransport({
            service: "gmail",
            host: "smtp.gmail.com",
            port: 587,
            secure: false,
            auth: {
                user: process.env.NODEMAILER_EMAIL,
                pass: process.env.NODEMAILER_PASSWORD
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        // Test connection first
        await transporter.verify();
        console.log('SMTP connection verified successfully');

        const mailOptions = {
            from: process.env.NODEMAILER_EMAIL, // Simplified from object
            to: email,
            subject: "Verify your account - OTP",
            text: `Your OTP for account verification is: ${otp}. This OTP will expire in 10 minutes.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Account Verification</h2>
                    <p>Your OTP for account verification is:</p>
                    <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; color: #333; margin: 20px 0; border-radius: 8px;">
                        ${otp}
                    </div>
                    <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                    <p style="color: #666;">If you didn't request this, please ignore this email.</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.messageId);
        console.log('Response:', info.response);
        
        return true; // Return true on success
        
    } catch (error) {
        console.error("Email sending error:", error);
        
        // More specific error logging
        if (error.code === 'EAUTH') {
            console.error("❌ Authentication failed. Check your Gmail App Password");
        } else if (error.responseCode === 535) {
            console.error("❌ Invalid credentials. Make sure 2FA is enabled and you're using App Password");
        } else if (error.code === 'ECONNECTION') {
            console.error("❌ Connection failed. Check internet connection");
        }
        
        return false;
    }
}

const securePassword = async (password) => {
    try {
        const passwordHash = await bcrypt.hash(password,10);
        return passwordHash;
    } catch (error) {
        console.error("Password hashing error:", error);
        throw error;
    }
}

const resendOtp = async (req, res) => {
    try {
        console.log("Resend OTP requested"); // Debug log
        console.log("Session userData:", req.session.userData); // Debug log

        if (!req.session.userData || !req.session.userData.email) {
            console.log("No email found in session"); // Debug log
            return res.status(400).json({ success: false, message: 'Session expired. Please start signup again.' });
        }

        const { email } = req.session.userData;

        // Generate new OTP
        const otp = generateOtp();

        // Store OTP in session
        req.session.userOtp = otp;

        // Send OTP via email
        const emailSent = await sendVerificationEmail(email, otp);

        console.log("Generated OTP for resend:", otp);

        // Check if the email was sent successfully
        if (emailSent) {
            console.log("Resent OTP successfully:", otp);
            return res.status(200).json({ success: true, message: 'OTP Resent Successfully' });
        } else {
            console.log("Failed to resend OTP:", otp);
            return res.status(500).json({ success: false, message: 'Failed to resend OTP. Please try again' });
        }
    } catch (error) {
        console.error('Error Resending OTP', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error, Please try again' });
    }
};

const login = async (req, res) => {
  try {
    const { email, password, googleLogin } = req.body;

    if (!email) {
      return res.render('login', { message: "Please enter email" });
    }

    let user;

    // Google login path
    if (googleLogin === 'true') {
      user = await User.findOne({ email, isAdmin: false });

      if (!user) {
        return res.render('login', { message: "Google user not found" });
      }

      if (user.isBlocked) {
        return res.render('login', { message: "User is blocked by admin" });
      }

      // No password check for Google users
      req.session.user = user._id;
      return res.redirect('/');
    }

    // Normal login path
    if (!password) {
      return res.render('login', { message: "Please enter password" });
    }

    user = await User.findOne({ email, isAdmin: false });

    if (!user) {
      return res.render('login', { message: "User not found" });
    }

    if (user.isBlocked) {
      return res.render('login', { message: "User is blocked by admin" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.render('login', { message: "Invalid password" });
    }

    req.session.user = user._id;
    return res.redirect('/');
  } catch (error) {
    console.error("Login error:", error);
    return res.render('login', { message: "Login failed. Try again." });
  }
};

const logout = async (req,res) => {
    try {
        req.session.destroy((error) => {
            if(error) {
                console.log("Session destruction error");
                return res.redirect('/pageNotFound')
            }
            return res.redirect("/login")
        })
    } catch (error) {
        console.log("logout error", error );
        res.redirect("/pageNotFound")
    }
}

const loadShoppingPage = async (req, res) => {
    try {
        const user = req.session.user;
        const userData = user ? await User.findOne({ _id: user }) : null;

        const page = parseInt(req.query.page) || 1;
        const limit = 9;
        const skip = (page - 1) * limit;

        // Get listed categories
        const listedCategories = await Category.find({ isListed: true });
        const listedCategoryIds = listedCategories.map(category => category._id);

        // Base query
        let query = {
            isBlocked: false,
            category: { $in: listedCategoryIds },
            variants: { $elemMatch: { quantity: { $gt: 0 } } }
        };

        // Search
        if (req.query.search) {
            query.productName = { $regex: req.query.search, $options: 'i' };
        }

        // Category filter
        if (req.query.category) {
            query.category = req.query.category;
        }

        // Sorting
        let sort = {};
        switch (req.query.sort) {
            case 'popularity': sort = { popularity: -1 }; break;
            case 'price_asc': sort = { salePrice: 1 }; break;
            case 'price_desc': sort = { salePrice: -1 }; break;
            case 'rating': sort = { averageRating: -1 }; break;
            case 'featured': sort = { featured: -1 }; break;
            case 'new': sort = { createdAt: -1 }; break;
            case 'name_asc': sort = { productName: 1 }; break;
            case 'name_desc': sort = { productName: -1 }; break;
            default: sort = { createdAt: -1 }; // Default: latest products
        }

        // Category with product counts
        const categoriesWithCounts = await Category.aggregate([
            { $match: { isListed: true } },
            {
                $lookup: {
                    from: 'products',
                    let: { categoryId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$category', '$$categoryId'] },
                                        { $eq: ['$isBlocked', false] },
                                        { $isArray: '$variants' },
                                        {
                                            $gt: [
                                                {
                                                    $size: {
                                                        $filter: {
                                                            input: '$variants',
                                                            cond: { $gt: ['$$this.quantity', 0] }
                                                        }
                                                    }
                                                },
                                                0
                                            ]
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    as: 'products'
                }
            },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    productCount: { $size: '$products' }
                }
            }
        ]);

        // Paginated product results
        const products = await Product.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit);

        const totalProducts = await Product.countDocuments(query);
        const totalPages = Math.ceil(totalProducts / limit);

        //  Fetch Latest Products
        const latestProducts = await Product.find({
            isBlocked: false,
            category: { $in: listedCategoryIds },
            variants: { $elemMatch: { quantity: { $gt: 0 } } }
        })
        .sort({ createdAt: -1 })
        .limit(6);

        // Fetch Best-Selling Products (assuming you have a 'sold' field)
        const bestSellingProducts = await Product.find({
            isBlocked: false,
            category: { $in: listedCategoryIds },
            variants: { $elemMatch: { quantity: { $gt: 0 } } }
        })
        .sort({ sold: -1 }) // Make sure you maintain this field on purchase
        .limit(6);

        // Final render
        res.render("shop", {
            user: userData,
            products,
            category: categoriesWithCounts,
            totalProducts,
            currentPage: page,
            totalPages,
            search: req.query.search || '',
            sort: req.query.sort || '',
            selectedCategory: req.query.category || '',
            latestProducts,
            bestSellingProducts,
            req
        });

    } catch (error) {
        console.error("Error loading shopping page:", error);
        res.status(500).redirect("/pageNotFound");
    }
};

const getAboutPage = async (req,res) =>{
    try{
        res.render('about')
    } 
    catch(error){
        res.redirect('/')
    }
}

const getContact = async (req,res) => {
    try{
        res.render('contact')
    } catch(error) {
        res.redirect('/')
    }
}

module.exports = {loadHome,
    pageNotFound,
    loadsignup, 
    loadLogin,
    signup,
    verifyOtp,
    resendOtp,
    login,
    logout,
    loadShoppingPage,
    generateReferralCode,
    getAboutPage,
    getContact
}