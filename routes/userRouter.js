const upload = require('../helper/multer');
const express = require("express");
const router = express.Router();
const userController = require('../controller/userController');
const profileController = require('../controller/profileController');
const productController = require("../controller/productController")
const cartController = require("../controller/cartController")
const checkoutController = require('../controller/checkoutController')
const orderController = require('../controller/orderController')
const couponController = require('../controller/couponController')
const walletController = require('../controller/walletController')
const wishlistController = require('../controller/wishlistController')

const passport = require("passport");
const { userAuth,addCartWishlist,checkUserAuthWish,ajaxAuth } = require('../middleware/auth');
const {resetPasswordMiddleware,blockLoggedInUsers, checkBlockedUser,checkLoggedIn,forgotPassLogout} = require("../middleware/profileAuth")


// Routes
router.get('/pageNotFound', userController.pageNotFound);
router.get('/', userController.loadHome);
router.get('/login', userController.loadLogin);
router.get('/signup', userController.loadsignup);
router.post('/signup', userController.signup);

router.post('/verify-otp', userController.verifyOtp);
router.post('/resend-otp', userController.resendOtp);
router.post('/login', userController.login);
router.get('/logout', userController.logout)


// Google login start
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google login callback
router.get('/auth/google/callback',
    passport.authenticate('google', {
        failureRedirect: '/login',
        failureMessage: true  // <-- Enables messages
    }),
    (req, res) => {
        req.session.user = req.user._id;
        res.redirect('/');
    }
);

//profile management
 router.get("/forgot-password",blockLoggedInUsers,profileController.getForgotPassPage)
 router.post("/forgot-email-valid",blockLoggedInUsers,profileController.forgotEmailValid)
 router.post("/verify-passForgot-otp",blockLoggedInUsers,profileController.verifyForgotPassOtp)
 router.get("/reset-password",resetPasswordMiddleware,profileController.getResetPassPage)
 router.post("/resend-forgot-otp",blockLoggedInUsers,profileController.resendOtp);
 router.post("/reset-password",resetPasswordMiddleware,profileController.postNewPassword);

router.post("/change-password", userAuth, profileController.changePassword)

router.get('/userProfile', userAuth, profileController.userProfile)
router.get('/update-email',userAuth,profileController.getUpdateEmail);
router.post('/update-email', userAuth, profileController.updateEmail)
router.post("/update-profile",userAuth,profileController.updateProfile)
router.get('/change-email-otp', userAuth,profileController.changeEmailOtp )
router.post('/change-email-otp',userAuth,profileController.changeEmailValid)
router.post("/verify-email-otp",userAuth,profileController.verifyEmailOtp)

router.post('/upload-profile-image', upload.single('profileImage'), profileController.updateProfileImage);





//shopping page
 router.get('/shop', userAuth, userController.loadShoppingPage)
 router.get("/productDetails",productController.productDetails);
  router.post("/addToCartFromShop", ajaxAuth, cartController.addToCartFromShop);
router.post("/addToWishlistFromShop", ajaxAuth, wishlistController.addToWishlistFromShop)


 //address management
 router.get('/address', userAuth, profileController.loadAddressPage)
 router.get('/addAddress', userAuth, profileController.addAddress)
 router.post('/addAddress', userAuth, profileController.postAddAddress)
 router.get('/editAddress', userAuth,profileController.editAddress)
 router.post('/editAddress', userAuth, profileController.postEditAddress)
 router.get('/deleteAddress', userAuth, profileController.deleteAddress)

 //cart management
 router.get('/cart', userAuth, cartController.getCart);
 router.post("/addToCart", ajaxAuth, cartController.addToCart);
router.post("/changeQuantity", userAuth, cartController.changeQuantity);
router.get('/deleteItem', userAuth, cartController.deleteItem);

// Checkout Management
router.get("/checkout",userAuth,checkoutController.loadCheckoutPage)
router.get("/addAddressCheckout",userAuth,checkoutController.addAddressCheckout)
router.post("/addAddressCheckout",userAuth,checkoutController.postAddAddressCheckout)
router.get('/retry',userAuth,checkoutController.retry);
router.post('/placeOrder', userAuth, checkoutController.placeOrder)


// Order Management

router.get("/orders", userAuth, orderController.getOrders);

router.get("/order-details", userAuth, orderController.loadOrderDetails);
router.post('/request-return', userAuth,orderController.requestReturn)
router.get('/download-invoice/:orderId', userAuth, orderController.downloadInvoice);

router.post('/orders/cancel-return',userAuth,orderController.cancelReturn)
router.post("/orders/cancel", userAuth, orderController.cancelOrder);


router.get('/orderSuccess', userAuth, checkoutController.orderSuccess);

router.get('/orderFailure', userAuth, checkoutController.orderFailure);

router.post('/verifyPayment', userAuth, checkoutController.verifyPayment);


//coupon management
router.get("/mycoupons",userAuth,couponController.loadCoupons)
router.post("/apply-coupon", userAuth, checkoutController.applyCoupon);


// wallet Management
router.get('/wallet',userAuth, walletController.getWalletPage);




// wishlist management

router.get("/wishlist",userAuth,wishlistController.loadWishlist)
router.post("/addToWishlist",ajaxAuth,wishlistController.addToWishlist)
router.get("/removeFromWishList",userAuth,wishlistController.removeProduct)
router.post('/addToCartFromWishList',ajaxAuth,wishlistController.addToCartFromWishlist)












module.exports = router;
