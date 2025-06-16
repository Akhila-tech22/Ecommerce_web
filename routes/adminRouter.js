const express = require('express');
const router = express.Router();

const adminController = require('../controller/adminController');
const { userAuth, adminAuth } = require('../middleware/auth');
const customerController = require('../controller/customerController');
const categoryController = require('../controller/categoryController');
const brandController = require('../controller/brandController');
const productController = require('../controller/productController');
const bannerController = require('../controller/bannerController')
const adminOrderController = require('../controller/adminOrderController')
const adminCouponController = require('../controller/adminCouponController')
const salesController = require('../controller/salesController')
const upload = require('../helper/multer'); 

// ------------------ Login Management ------------------ //
router.get('/pageerror', adminController.pageerror);
router.get('/login', adminController.loadLogin);
router.post('/login', adminController.login);
router.get('/', adminAuth, adminController.loadDashboard);
router.post('/logout', adminController.logout);

// ------------------ Customer Management ------------------ //
router.get('/users', adminAuth, customerController.customerInfo);
router.get('/blockCustomer', adminAuth, customerController.customerBlocked);
router.get('/unblockCustomer', adminAuth, customerController.customerUnblocked);

// ------------------ Category Management ------------------ //
router.get('/category', adminAuth, categoryController.categoryInfo);
router.post('/addCategory', adminAuth, categoryController.addCategory);
router.post('/addCategoryOffer', adminAuth, categoryController.addCategoryOffer);
router.post('/removeCategoryOffer', adminAuth, categoryController.removeCategoryOffer);
router.get('/listCategory', adminAuth, categoryController.getListCategory);
router.get('/unListCategory', adminAuth, categoryController.getUnlistCategory);
router.put('/editCategory/:id', adminAuth, categoryController.editCategory);

router.post('/editCategory/:id', adminAuth, categoryController.editCategory);
router.post('/editCategoryOffer', adminAuth, categoryController.editCategoryOffer);
router.delete('/deleteCategory/:id', adminAuth, categoryController.deleteCategory);

// ------------------ Brand Management ------------------ //
router.get('/brands', brandController.getBrandPage);
router.post('/addBrand', adminAuth, upload.single('image'), brandController.addBrand);
router.get('/blockBrand', adminAuth, brandController.blockBrand);
router.get('/unBlockBrand', adminAuth, brandController.unBlockBrand);
router.get('/deleteBrand', adminAuth, brandController.deleteBrand);

// ------------------ Product Management ------------------ //

router.get("/addProducts", adminAuth, productController.getProductAddPage);
router.post("/saveImage", adminAuth, upload.single('image'), productController.saveImage);
router.post("/addProducts", adminAuth, upload.fields([
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 },
    { name: 'image4', maxCount: 1 }
]), productController.addProducts);
router.get('/products', adminAuth, productController.getAllProducts);
router.post('/addProductOffer',adminAuth, productController.addProductOffer)
router.post('/removeProductOffer',adminAuth, productController.removeProductOffer)
router.get("/blockProduct",adminAuth,productController.blockProduct);
router.get("/unblockProduct",adminAuth,productController.unblockProduct);
router.get('/editProduct', adminAuth, productController.getEditProduct)
router.post("/editProduct/:id", adminAuth, upload.fields([
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 },
    { name: 'image4', maxCount: 1 }
]), productController.editProduct);
router.post("/deleteImage",adminAuth,productController.deleteSingleImage)

router.get('/deleteProduct',adminAuth,productController.deleteProduct);

// Order Management Routes
router.get('/orders', adminAuth, adminOrderController.getOrders);
router.get('/orders/:id', adminAuth, adminOrderController.getOrderDetails);
router.post('/orders/update-status', adminAuth, adminOrderController.updateOrderStatus);
router.post('/orders/update-return-status', adminAuth, adminOrderController.updateReturnStatus);




// Coupon Management
router.get("/coupon",adminAuth,adminCouponController.loadCoupon)
router.post("/createCoupon",adminAuth,adminCouponController.createCoupon)
router.get("/editCoupon",adminAuth,adminCouponController.editCoupon)
router.post("/updateCoupon",adminAuth,adminCouponController.updateCoupon)
router.get("/deletecoupon",adminAuth,adminCouponController.deleteCoupon)


// Sales Routes - Corrected Version
router.get('/sales', adminAuth, salesController.loadSalesPage);
router.get('/sales/report', adminAuth, salesController.loadSalesPage);

// API Routes for Sales Data
router.get('/api/sales-data', adminAuth, salesController.getSalesData);
router.post('/api/sales-report', adminAuth, salesController.getSalesReport);
router.post('/api/download-sales-report', adminAuth, salesController.downloadSalesReport);

// Keep these if they exist in adminController, otherwise remove or move to salesController
router.get("/api/top-selling", adminAuth, adminController.getTopSelling);

// Dashboard route
router.get("/dashboard", adminAuth, async (req, res) => {
    try {
        res.redirect("/admin");
    } catch (error) {
        res.redirect("/admin/pageerror");
    }
});
module.exports = router;






