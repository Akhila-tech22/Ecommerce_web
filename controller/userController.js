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
    return crypto.randomBytes(4).toString('hex').toUpperCase();
};

const signup = async (req, res) => {
    try {
        const { name, phone, email, password, cPassword, code } = req.body;
        
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
        const emailSent = await sendVerificationEmail(email, otp);

        if (!emailSent) {
            return res.json({ message: "email-error" });
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

        res.render("verify-otp");  
        console.log("OTP sent", otp);

    } catch (error) {
        console.error("Signup error", error);
        res.redirect("/pageNotFound");
    }
};



// Updated verifyOtp function with transaction recording
const verifyOtp = async (req, res) => {
    try {
        const { otp } = req.body;
        
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
                    // Add 1000 RP to referral owner's wallet
                    const oldWalletBalance = referralOwner.wallet;
                    referralOwner.wallet += 1000;
                    const newWalletBalance = referralOwner.wallet;
                    
                    // Add new user to referral owner's redeemed users list
                    referralOwner.redeemedUsers.push(saveUserData._id);
                    
                    await referralOwner.save();

                    // Create transaction record for referral reward
                    const transaction = new Transaction({
                        userId: referralOwner._id,
                        amount: 1000,
                        transactionType: 'credit',
                        paymentMethod: 'admin',
                        paymentGateway: 'admin',
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
                    
                    console.log(`Referral reward processed: ${referralOwner.name} received ₹1000 for referring ${saveUserData.name}`);
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
        const categories = await Category.find({isListed:true})
        let productData = await Product.find({
            isBlocked:false,
            category:{$in:categories.map(category=>category._id)},
            quantity:{$gt:0},
        })

        productData.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt))
        productData = productData.slice(0,12);


        if(user){
            const userData = await User.findOne({_id:user});
            res.render('home',{user:userData, products:productData, })
            
            
        } else{
            return res.render('home',{products:productData,req:req})
        }
            
        
    } catch (error) {
        console.log('Home Page Not Found')
        res.status(500).send('Server Error')
    }
}


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
        console.log("loadsignup error:", error.message);  // 🔥 see what went wrong
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
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, otp) {
    try {
        const transporter = nodemailer.createTransport({
            service: "gmail",
            port: 587,
            secure: false,
            requireTLS: true,
            auth: {
                user: process.env.NODEMAILER_EMAIL,
                pass: process.env.NODEMAILER_PASSWORD
            }
        });

        const info = await transporter.sendMail({
            from: process.env.NODEMAILER_EMAIL,
            to: email,
            subject: "Verify your account",
            text: `Your OTP is ${otp}`,
            html: `<b>Your OTP: ${otp}</b>`
        });
        return info.accepted.length > 0;
    } catch (error) {
        console.error("Error sending email", error);
        return false;
    }
}



const securePassword = async (password) => {
    try {
        
        const passwordHash = await bcrypt.hash(password,10);

        return passwordHash;

    } catch (error) {
        
    }
}





const resendOtp = async (req, res) => {
    try {
        const { email } = req.session.userData;

        // Check if email exists in session
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email not found in session' });
        }

        // Generate new OTP
        const otp = generateOtp();

        // Store OTP in session
        req.session.userOtp = otp;

        // Send OTP via email
        const emailSent = await sendVerificationEmail(email, otp);

        console.log("Generated OTP:", otp);

        // Check if the email was sent successfully
        if (emailSent) {
            console.log("Resended OTP:", otp);
            return res.status(200).json({ success: true, message: 'OTP Resent Successfully' });
        } else {
            console.log("Failed to resend OTP", otp);
            return res.status(500).json({ success: false, message: 'Failed to resend OTP. Please try again' });
        }
    } catch (error) {
        console.error('Error Resending OTP', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error, Please try again' });
    }
};



const login = async (req, res) => {
  try {
    const { email, password, googleLogin } = req.body; // use a flag like 'googleLogin' to detect Google login

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

        // ✅ Fetch Latest Products
        const latestProducts = await Product.find({
            isBlocked: false,
            category: { $in: listedCategoryIds },
            variants: { $elemMatch: { quantity: { $gt: 0 } } }
        })
        .sort({ createdAt: -1 })
        .limit(6);

        // ✅ Fetch Best-Selling Products (assuming you have a 'sold' field)
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
 
   
}