const User = require("../models/userSchema");
const Address = require("../models/addressSchema");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session")
const multer = require("multer")
const sharp = require("sharp")
const fs = require("fs")
const path = require("path")




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
        return passwordHash

    } catch (error) {

        
    }
}



const getForgotPassPage = async (req,res) => {
    try {
        
        res.render("forgot-password");

    } catch (error) {

        res.redirect("/pageNotFound")
        
    }
}

const forgotEmailValid = async (req,res) => {
    try {
        
        const {email} = req.body;
        const findUser = await User.findOne({email:email});
        if(findUser){
            const otp = generateOtp();
            const emailSent = await sendVerificationEmail(email,otp);
           if(emailSent){
    req.session.userOtp = otp;
    req.session.email = email;
    console.log("OTP: ", otp);
    res.render("forgotPass-otp");  // Only render page, no JSON here
} else {
    res.render("forgot-password", {
        message: "Failed to send OTP. Please try again."
    });
}


        } else{
            res.render("forgot-password",{
                message:"User with this email does not exist"
            })
        }

    } catch (error) {

        res.redirec("/pageNotFound")
        
    }
}

const verifyForgotPassOtp = async (req,res) => {
    try {
        
        const enteredOtp = req.body.otp;
        if(enteredOtp === req.session.userOtp){
            req.session.resetAllowed = true;
            res.json({success:true,redirectUrl:"/reset-password"})
        } else{
            res.json({success:false,message:"OTP not matching"})
        }

    } catch (error) {

        res.status(500).json({success:false,message:"An error occured please try again"})
        
    }
}

const getResetPassPage = async (req,res) => {
    try {
        
        res.render("reset-password")

    } catch (error) {

        res.redirect("/pageNotFound")
        
    }
}

const resendOtp = async (req, res) => {
    try {
        const userId = req.session.user;

        if (!userId) {
            return res.status(401).json({ success: false, message: "User not logged in" });
        }

        const email = req.session.newEmail;
        if (!email) {
            return res.status(400).json({ success: false, message: "Email not found in session" });
        }

        const otp = generateOtp();
        req.session.userOtp = otp;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        console.log("Resending OTP to email:", email);
        const emailSent = await sendVerificationEmail(email, otp);

        if (emailSent) {
            user.email = email;
            await user.save();
            res.status(200).json({ success: true, message: "OTP resent successfully" });
        } else {
            res.status(500).json({ success: false, message: "Failed to send email" });
        }

    } catch (error) {
        console.error("Error in resendOtp:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

const postNewPassword = async (req,res) => {
    try {
        
        const {newPass1, newPass2} = req.body;
        const email = req.session.email;

        if(newPass1 === newPass2){
            const passwordHash = await securePassword(newPass1);
            await User.updateOne(
                {email:email},
                {$set:{password:passwordHash}}
            );


            req.session.userOtp = null;
            req.session.email = null;
            req.session.resetAllowed = null;
            
            res.redirect("/login")
        } else{
            res.render("reset-password",{message:"Password do not match"})
        }

    } catch (error) {

        res.redirect("/pageNotFound")
        
    }
}

 const updateProfile = async (req, res) => {
    try {
        const userId = req.session.user;
        const { name, username, phone } = req.body;

        // Validate phone number
        const phoneRegex = /^\d{10}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid 10-digit phone number'
            });
        }

        // Check if username is already taken
        if (username) {
            const existingUser = await User.findOne({
                username,
                _id: { $ne: userId }
            });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Username is already taken. Please choose a different one.'
                });
            }
        }

        // Update user profile
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { name, username, phone },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while updating your profile'
        });
    }
};

const changeEmailOtp = async (req,res) => {
    try{

        res.render('change-email-otp')
    }catch(error){
        res.redirect('/PageNotFound');
    }
}










const changeEmailValid = async (req,res) => {
    try {
        const userId = req.session.user;
        const email = req.session.newEmail;
        console.log(email);
        const userExist = await User.findById({_id : userId });
        if(userExist){
          
            const otp = generateOtp();
            const emailSent = await sendVerificationEmail(email,otp)
            if(emailSent) {
                req.session.newEmail = email;
                req.session.otp = otp;
                console.log(`Email Sent : ${email}, Otp: ${otp}`)
                res.render("change-email-otp");
           
            }else {
                res.json("email-error")
            }
        }else{
            res.render("change-email",{
                message: "User with email not exist"
            })
        }

    } catch (error) {

        res.redirect("/pageNotFound")
        
    }
}



const verifyEmailOtp = async (req, res) => {
  try {
    const enteredOtp = req.body.otp;
    const userId = req.session.user;
    const sessionOtp = req.session.otp;


    const user = await User.findById(userId);

    if (enteredOtp === sessionOtp) {
     
      user.email = req.session.newEmail;
      await user.save(); 
      return res.json({ success: true, message: "Successfully" });
    } else {
      return res.json({ success: false, message: "something wrong!" });
    }

  } catch (error) {
    console.error("Error in OTP verification:", error);
    res.redirect("/pageNotFound");
  }
};



const getUpdateEmail = async (req,res) => {
    try{
        res.render('new-email')
    }catch(error) {
        res.redirect('/pageNotFound');
    }
}

const updateEmail = async (req, res) => {
  try {
    const { newEmail, oldEmail } = req.body;
    const userId = req.session.user;

    if (!newEmail || !oldEmail) {
      return res.json({ success: false, message: "Missing email fields" });
    }

    // Find user by ID
    const user = await User.findById(userId);

    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

   if (user.email.trim().toLowerCase() !== oldEmail.trim().toLowerCase()) {
  return res.json({ success: false, message: "Old email does not match!" });
}


    // Optional: Check if newEmail already exists in DB
    const emailExists = await User.findOne({ email: newEmail });
    if (emailExists) {
      return res.json({ success: false, message: "New email already in use" });
    }

   
    req.session.newEmail = newEmail;

    return res.json({ success: true, message: "New email saved successfully" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


  

const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const userId = req.session.user;
        

        
        if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long and contain both letters and numbers.' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Passwords do not match.' });
        }

        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Check if the current password is correct
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, error: 'current_password_incorrect', message: 'Current password is incorrect.' });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user's password
        user.password = hashedPassword;
        await user.save();

        res.json({ success: true, message: 'Password changed successfully.' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ success: false, message: 'An error occurred while changing the password.' });
    }
};
  
const userProfile = async (req,res) => {
    try {
        
        const userId = req.session.user;
        const userData = await User.findById(userId);
        res.render("profile",{
            user:userData,

        })

      
        

    } catch (error) {

        console.error('Error:',error)
        res.redirect("/pageNotFound")
        
    }
}

const loadAddressPage = async (req,res) => {
    try {
        const userId = req.session.user;
        const findUser = await User.findById(userId)
        const findAddress = await Address.findOne({userId : userId})
        if(findUser) {
            res.render('address', {
                user : findUser,
                userAddress : findAddress,
            })
        } else {
            res.redirect('profile')
        }
        
    }catch(error) {
        res.redirect('/pageNotFound')
    }
}

const addAddress = async (req,res) => {
    try {
        const user = req.session.user;
        const fromPage = req.query.from;
        const addressId = req.query.id;
        res.render('add-address', {user : user, from : fromPage})
    }catch(error) {
        res.redirect('/pageNotFound')

    }
}

const postAddAddress = async (req,res) => {
    try {
        
        const userId = req.session.user;
        const userData = await User.findOne({_id:userId})
        const { addressType, name, country, city, landMark, state, streetAddress, pincode, phone, altPhone } = req.body;

        const userAddress = await Address.findOne({userId:userData._id});
        
        if(!userAddress){
            const newAddress = new Address({
                userId:userData,
                address: [{addressType, name, country, city, landMark, state, streetAddress, pincode, phone, altPhone}]

            });
            await newAddress.save();
        }else{
            userAddress.address.push({addressType, name, country, city, landMark, state, streetAddress, pincode, phone, altPhone})
            await userAddress.save();
        }

        res.redirect("/address")

    } catch (error) {

        console.error("Error adding address",error)

        res.redirect("/pageNotFound")
        
    }
}

const editAddress = async (req, res) => {
    try {
        const addressId = req.query.id;
        const fromPage = req.query.from; 
        const userId = req.session.user;

        const userData = await User.findById(userId);
        const currAddress = await Address.findOne({ "address._id": addressId }); //doc

        if (!currAddress) {
            return res.redirect("/pageNotFound");
        }

        const addressData = currAddress.address.find(item =>
            item._id.toString() === addressId.toString()
        );

        if (!addressData) {
            return res.redirect("/pageNotFound");
        }

        res.render("edit-address", {
            address: addressData,
            user: userData,
            from: fromPage  //  pass it to the view
        });

    } catch (error) {
        console.error("Error in edit Address", error);
        res.redirect("/pageNotFound");
    }
};


const postEditAddress = async (req,res) => {
    try {

        const data = req.body;
        const addressId = req.query.id;
        const user = req.session.user;
        const findAddress = await Address.findOne({
            "address._id":addressId
        });
        if(!findAddress){
            res.redirect("/pageNotFound")
        }
        await Address.updateOne(
            {"address._id":addressId},
            {$set:{
                "address.$":{
                    _id:addressId,
                    addressType:data.addressType,
                    name:data.name,
                    country:data.country,
                    city:data.city,
                    landMark:data.landMark,
                    state:data.state,
                    streetAddress:data.streetAddress,
                    pincode:data.pincode,
                    phone:data.phone,
                    altPhone:data.altPhone
                }
            }}
        )

        res.redirect("/address")
        
    } catch (error) {

        console.error("Error in editing address",error)
        res.redirect("/pageNotFound")
        
    }
}

const deleteAddress = async (req,res) => {
    try {
        
        const addressId = req.query.id;
        const findAddress = await Address.findOne({"address._id":addressId})

        if(!findAddress){
            return res.status(404).send("Address Not Found")
        }

        await Address.updateOne(
        {
            "address._id":addressId
        },
        {
            $pull: {            //remove 
                address:{
                    _id:addressId,
                }
            }
        })

        res.redirect("/address")

    } catch (error) {

        console.error("Error in deleting in address",error)
        res.redirect("/pageNotFound")
        
    }
}


const updateProfileImage = async (req, res) => {
  try {
    const userId = req.session.user;
    const imageName = req.file.filename;
    await User.findByIdAndUpdate(userId, { profilePicture: imageName });
    res.redirect('/userProfile');
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).send('Failed to upload profile image.');
  }
};







module.exports = {
    getForgotPassPage,
    forgotEmailValid,
    verifyForgotPassOtp,
    getResetPassPage,
    resendOtp,
    postNewPassword,
    changeEmailValid,
    verifyEmailOtp,
    changePassword,
    
    userProfile,
    updateEmail,
    loadAddressPage,
    addAddress,
    postAddAddress,
    editAddress,
    postEditAddress,
    deleteAddress,
    updateProfile,
    updateProfileImage,
    getUpdateEmail,
    changeEmailOtp,
    
    

}