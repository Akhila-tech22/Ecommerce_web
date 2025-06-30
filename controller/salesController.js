const Sale = require("../models/salesSchema");
const Order = require("../models/orderSchema");
const Product = require("../models/productSchema");
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const Coupon = require('../models/couponSchema')

const loadSalesPage = async (req, res) => {
  try {
    const { reportType, startDate, endDate, format } = req.query;
    let query = {};

    const now = new Date();

    switch (reportType) {
      case 'daily':
        const today = new Date();
        query.createdOn = {
          $gte: new Date(today.setHours(0, 0, 0, 0)),
          $lt: new Date(today.setHours(23, 59, 59, 999))
        };
        break;

      case 'weekly':
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        query.createdOn = {
          $gte: new Date(weekStart.setHours(0, 0, 0, 0)),
          $lt: new Date()
        };
        break;

      case 'monthly':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        query.createdOn = {
          $gte: monthStart,
          $lt: monthEnd
        };
        break;

      case 'custom':
        if (startDate && endDate) {
          query.createdOn = {
            $gte: new Date(startDate),
            $lt: new Date(new Date(endDate).setHours(23, 59, 59, 999))
          };
        }
        break;

      default:
        query.createdOn = {
          $gte: new Date(now.getFullYear(), now.getMonth(), 1),
          $lt: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        };
    }

    const orders = await Order.find({
      ...query,
      paymentStatus: { $ne: 'failed' }, 
      $or: [
     
        { 
          paymentMethod: 'cod', 
          'orderedItems.status': 'delivered' 
        },
        // Online orders that are not cancelled and payment is completed
        { 
          paymentMethod: 'online', 
          paymentStatus: 'completed',
          'orderedItems.status': { $nin: ['cancelled', 'payment_failed'] }
        },
         { 
    paymentMethod: 'wallet', 
    paymentStatus: 'completed',
    'orderedItems.status': { $nin: ['cancelled', 'payment_failed'] }
  },
     

      ]
    })
    .populate('orderedItems.product')
    .populate('couponDetails.couponId')
    .sort({ createdOn: 1 });

    let totalRegularPrice = 0;
    let totalFinalAmount = 0;
    let totalDiscounts = 0;
    let totalCoupons = 0;

    const sales = [];

    for (const order of orders) {
      
      // Fixed: Proper coupon handling
      const couponDiscount = order.couponApplied && order.couponDetails?.discountAmount
        ? order.couponDetails.discountAmount
        : 0;

      // Get coupon code properly
      const couponCode = order.couponApplied && order.couponDetails?.couponCode 
        ? order.couponDetails.couponCode 
        : (order.couponApplied && order.couponDetails?.couponId?.code 
           ? order.couponDetails.couponId.code 
           : 'N/A');

      // Filter items based on their individual status
     const validItems = order.orderedItems.filter(item => {
  if (order.paymentMethod === 'cod') {
    return item.status === 'delivered';
  } else if (order.paymentMethod === 'online' || order.paymentMethod === 'wallet') {
    return item.status !== 'cancelled' && item.status !== 'payment_failed' && order.paymentStatus === 'completed';
  }
  return false;
});

      // Skip if no valid items
      if (validItems.length === 0) continue;

      // Calculate revenue based on valid items only
      let itemsRevenue = 0;
      let itemsRegularPrice = 0;
      let orderItemDiscounts = 0;

      for (const item of validItems) {
        const itemRegularPrice = item.regularPrice * item.quantity;
        const itemFinalPrice = item.price * item.quantity;
        const itemDiscount = itemRegularPrice - itemFinalPrice;

        itemsRevenue += itemFinalPrice;
        itemsRegularPrice += itemRegularPrice;
        orderItemDiscounts += itemDiscount;
      }

      // Calculate proportional delivery charge and coupon discount
      const itemsRatio = validItems.length / order.orderedItems.length;
      const proportionalDeliveryCharge = order.deliveryCharge * itemsRatio;
      const proportionalCouponDiscount = couponDiscount * itemsRatio;

      const salesAmount = itemsRevenue + proportionalDeliveryCharge;

      // Revenue recognition logic
      let salesDate = order.createdOn;
      if (order.paymentMethod === 'cod') {
        // For COD, use the delivery date of the first delivered item
        const deliveredItem = validItems.find(item => item.status === 'delivered');
        salesDate = order.deliveredOn || order.updatedOn || order.createdOn;
      }

      totalRegularPrice += itemsRegularPrice;
      totalFinalAmount += salesAmount;
      totalDiscounts += orderItemDiscounts;
      totalCoupons += proportionalCouponDiscount;

      sales.push({
        orderId: order.orderId || order._id.toString(),
        productId: validItems[0]?.product ? validItems[0].product._id : null,
        productName: validItems.map(item => item.product ? item.product.name : item.productName).join(', '),
        quantity: validItems.reduce((sum, item) => sum + item.quantity, 0),
        regularPrice: itemsRegularPrice,
        finalPrice: salesAmount,
        totalAmount: salesAmount,
        discount: orderItemDiscounts,
        coupon: proportionalCouponDiscount,
        couponCode: couponCode,
        lessPrice: itemsRegularPrice - salesAmount,
        date: salesDate,
        deliveryDate: order.deliveredOn || order.updatedOn,
        paymentMethod: order.paymentMethod,
        itemsIncluded: validItems.length + '/' + order.orderedItems.length + ' items'
      });
    }

    const salesData = {
      sales,
      totalSales: totalFinalAmount,
      orderCount: sales.length,
      discounts: totalDiscounts,
      coupons: totalCoupons,
      lessPrices: totalRegularPrice - totalFinalAmount,
      reportType: reportType || 'monthly',
      startDate: startDate || '',
      endDate: endDate || ''
    };

    if (format === 'pdf') {
      return generatePDF(res, salesData);
    } else if (format === 'excel') {
      return generateExcel(res, salesData);
    }

    res.render('admin/sales-report', { salesData });

  } catch (error) {
    console.error('Error in loadSalesPage:', error);
    res.status(500).render('admin/pageerror', {
      message: 'Error loading sales report',
      error: error.message
    });
  }
};

const getSalesReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'Start date and end date are required' 
      });
    }

    // Fixed: Updated query to handle orderedItems.status
    const dateQuery = {
      createdOn: {
        $gte: new Date(startDate),
        $lte: new Date(endDate + 'T23:59:59.999Z')
      },
      paymentStatus: { $ne: 'failed' }, // Exclude failed payments
      $or: [
        // COD orders with at least one delivered item
        { 
          paymentMethod: 'cod', 
          'orderedItems.status': 'delivered' 
        },
        // Online orders that are not cancelled and payment is completed
        { 
          paymentMethod: 'online', 
          paymentStatus: 'completed',
          'orderedItems.status': { $nin: [ 'payment_failed'] }
        },
         // Wallet orders that are not cancelled and payment is completed
  { 
    paymentMethod: 'wallet', 
    paymentStatus: 'completed',
    'orderedItems.status': { $nin: ['cancelled', 'payment_failed'] }
  },
        

      ]
    };

 const orders = await Order.find(dateQuery)
      .populate('userId', 'name email')
      .populate('orderedItems.product', 'name category regularPrice')
      .populate('couponDetails.couponId', 'code name')
      .sort({ createdOn: -1 });

    let totalOrders = 0;
    let totalSalesAmount = 0;
    let totalDiscount = 0;
    let netRevenue = 0;

    const formattedOrders = [];

    for (const order of orders) {
      // Filter items based on their individual status
      const validItems = order.orderedItems.filter(item => {
        if (order.paymentMethod === 'cod') {
          return item.status === 'delivered';
        } else if (order.paymentMethod === 'online' || order.paymentMethod === 'wallet') {
          return item.status !== 'cancelled' && item.status !== 'payment_failed' && order.paymentStatus === 'completed';
        }
        return false;
      });

      // Skip if no valid items
      if (validItems.length === 0) continue;

      // Simplified price calculations - get directly from DB
      const originalAmount = order.totalPrice + 50;
      const discountAmount = order.discount;
      const couponCode = order.couponDetails?.couponCode || 'N/A';
      const finalAmount = order.finalAmount;
      
      totalOrders++;
      totalSalesAmount += originalAmount;
      totalDiscount += discountAmount;
      netRevenue += finalAmount;

      formattedOrders.push({
        _id: order._id,
        orderId: order.orderId || order._id.toString(),
        customerName: order.userId?.name || 'Unknown',
        products: validItems,
        originalAmount: originalAmount,
        discountAmount: discountAmount,
        couponDetails: {
          couponCode: couponCode,
          discountAmount: order.couponDetails?.discountAmount || 0
        },
        finalAmount: finalAmount,
        paymentMethod: order.paymentMethod,
        status: order.paymentMethod === 'cod' ? 'delivered' : 'completed',
        createdAt: order.createdOn,
        itemsIncluded: validItems.length + '/' + order.orderedItems.length + ' items'
      });
    }

    const stats = {
      totalOrders: totalOrders,
      totalSalesAmount: totalSalesAmount,
      totalDiscount: totalDiscount,
      netRevenue: netRevenue
    };

    res.json({
      success: true,
      stats,
      orders: formattedOrders
    });

  } catch (error) {
    console.error('Error generating sales report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate sales report',
      error: error.message 
    });
  }
};

const getSalesData = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    let dateFilter = {};
    let groupBy = {};

    const now = new Date();
    
    switch (period) {
      case 'weekly':
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = { createdOn: { $gte: weekStart } };
        groupBy = {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdOn" } },
          total: { $sum: "$finalAmount" },
          count: { $sum: 1 }
        };
        break;
        
      case 'monthly':
        const monthStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        dateFilter = { createdOn: { $gte: monthStart } };
        groupBy = {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdOn" } },
          total: { $sum: "$finalAmount" },
          count: { $sum: 1 }
        };
        break;
        
      case 'yearly':
        const yearStart = new Date(now.getFullYear() - 4, 0, 1);
        dateFilter = { createdOn: { $gte: yearStart } };
        groupBy = {
          _id: { $dateToString: { format: "%Y", date: "$createdOn" } },
          total: { $sum: "$finalAmount" },
          count: { $sum: 1 }
        };
        break;
    }

    // Fixed: Updated aggregation to handle orderedItems.status
    const salesData = await Order.aggregate([
      { 
        $match: { 
          ...dateFilter,
          paymentStatus: { $ne: 'failed' }, // Exclude failed payments
          $or: [
            // COD orders with at least one delivered item
            { 
              paymentMethod: 'cod', 
              'orderedItems.status': 'delivered' 
            },
            // Online orders that are not cancelled and payment is completed
            { 
              paymentMethod: 'online', 
              paymentStatus: 'completed',
              'orderedItems.status': { $nin: ['cancelled', 'payment_failed'] }
            },
            // Wallet orders that are not cancelled and payment is completed
            { 
              paymentMethod: 'wallet', 
              paymentStatus: 'completed',
              'orderedItems.status': { $nin: ['cancelled', 'payment_failed'] }
            }
          ]
        } 
      },
      // Add a stage to filter and calculate revenue based on valid items only
      {
        $addFields: {
          validItems: {
            $filter: {
              input: "$orderedItems",
              cond: {
                $switch: {
                  branches: [
                    {
                      case: { $eq: ["$paymentMethod", "cod"] },
                      then: { $eq: ["$$this.status", "delivered"] }
                    },
                    {
                      case: { $in: ["$paymentMethod", ["online", "wallet"]] },
                      then: { 
                        $and: [
                          { $ne: ["$$this.status", "cancelled"] },
                          { $ne: ["$$this.status", "payment_failed"] },
                          { $eq: ["$paymentStatus", "completed"] }
                        ]
                      }
                    }
                  ],
                  default: false
                }
              }
            }
          }
        }
      },
      // Calculate revenue based on valid items
      {
        $addFields: {
          validItemsRevenue: {
            $sum: {
              $map: {
                input: "$validItems",
                as: "item",
                in: { $multiply: ["$$item.price", "$$item.quantity"] }
              }
            }
          },
          validItemsRatio: {
            $cond: {
              if: { $eq: [{ $size: "$orderedItems" }, 0] },
              then: 0,
              else: { $divide: [{ $size: "$validItems" }, { $size: "$orderedItems" }] }
            }
          }
        }
      },
      {
        $addFields: {
          adjustedRevenue: {
            $add: [
              "$validItemsRevenue",
              { $multiply: ["$deliveryCharge", "$validItemsRatio"] }
            ]
          }
        }
      },
      // Only include orders with valid items
      {
        $match: {
          "validItems.0": { $exists: true }
        }
      },
      { 
        $group: {
          ...groupBy,
          total: { $sum: "$adjustedRevenue" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const data = salesData.map(item => item.total || 0);
    const labels = salesData.map(item => item._id);

    res.json({
      success: true,
      data,
      labels,
      period
    });

  } catch (error) {
    console.error('Error fetching sales data:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch sales data',
      error: error.message 
    });
  }
};


const generatePDF = async (res, salesData) => {
  const doc = new PDFDocument();
  
 
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=sales-report.pdf");

  doc.pipe(res);

  // Add content to PDF
  doc.fontSize(20).text("Sales Report", { align: "center" });
  doc.moveDown();

  // Add summary
  doc.fontSize(14).text("Summary");
  doc.fontSize(12)
      .text(`Total Sales: Rs. ${salesData.totalSales.toLocaleString()}`)
      .text(`Total Orders: ${salesData.orderCount}`)
      .text(`Total Coupons: Rs. ${salesData.discounts.toLocaleString()}`) 
      .text(`Total Discounts: Rs. ${salesData.lessPrices.toLocaleString()}`); 

  doc.moveDown();

  
  doc.fontSize(14).text("Detailed Sales");
  let y = doc.y + 20;

  // Table headers
  const headers = ["Date", "Order ID", "Amount", "Discounts", "Coupons"];
  let x = 50;
  headers.forEach((header) => {
      doc.text(header, x, y);
      x += 100;
  });

  // Table rows
  y += 20;
  salesData.sales.forEach((sale) => {
      x = 50;
      doc.text(new Date(sale.date).toLocaleDateString(), x, y);
      x += 100;
      
      // Extract only the last 12 characters of orderId
      const shortOrderId = sale.orderId.toString().slice(-12);
      doc.text(shortOrderId, x, y);
      x += 100;

      doc.text(`Rs. ${sale.amount.toLocaleString()}`, x, y);
      x += 100;
      doc.text(`Rs. ${sale.lessPrice.toLocaleString()}`, x, y); 
      x += 100;
      doc.text(`Rs. ${sale.discount.toLocaleString()}`, x, y); 
      y += 20;
  });

  doc.end();
};


const generateExcel = async (res, salesData) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sales Report');
  
  // Add headers
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Order ID', key: 'orderId', width: 30 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Discounts', key: 'lessPrice', width: 15 }, 
    { header: 'Coupons', key: 'discount', width: 15 }
  ];
  
  
  worksheet.addRow(['Summary']);
  worksheet.addRow(['Total Sales', '', `Rs. ${salesData.totalSales.toLocaleString()}`]);
  worksheet.addRow(['Total Orders', '', salesData.orderCount]);
  worksheet.addRow(['Total Discounts', '', `Rs. ${salesData.discounts.toLocaleString()}`]);
  worksheet.addRow(['Total Less Prices', '', `Rs. ${salesData.lessPrices.toLocaleString()}`]);
  worksheet.addRow([]);
  
  
  worksheet.addRow(['Detailed Sales']);
  salesData.sales.forEach(sale => {
    worksheet.addRow({
      date: new Date(sale.date).toLocaleDateString(),
      orderId: sale.orderId.toString(),
      amount: `Rs. ${sale.amount.toLocaleString()}`,
      lessPrice: `Rs. ${sale.lessPrice.toLocaleString()}`, 
      discount: `Rs. ${sale.discount.toLocaleString()}` 
    });
  });
  

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=sales-report.xlsx');
  
  await workbook.xlsx.write(res);
};

const downloadSalesReport = async (req, res) => {
  try {
    const { format, startDate, endDate } = req.body;
    
    if (!format || !startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'Format, start date, and end date are required' 
      });
    }

    // Get filtered data with proper payment method logic
    const dateQuery = {
      createdOn: {
        $gte: new Date(startDate),
        $lte: new Date(endDate + 'T23:59:59.999Z')
      },
      $or: [
        // COD orders that are delivered (revenue recognized on delivery)
        { paymentMethod: 'COD', status: 'delivered' },
        // Online orders that are not cancelled (revenue recognized on payment)
        { paymentMethod: { $ne: 'COD' }, status: { $ne: 'cancelled' } }
      ]
    };

    const orders = await Order.find(dateQuery)
      .populate('userId', 'name email')
      .populate('orderedItems.product', 'name category regularPrice')
      .sort({ createdOn: -1 });

    // Calculate summary stats with proper revenue recognition
    let totalSales = 0;
    let totalDiscounts = 0;
    let totalCoupons = 0;
    let orderCount = 0;

    const salesArray = [];

    for (const order of orders) {
      let shouldInclude = false;
      let revenueAmount = 0;
      let revenueDate = order.createdOn;

      if (order.paymentMethod === 'COD') {
        if (order.orderedItems.some(item => item.status === 'delivered')) {
          shouldInclude = true;
          revenueAmount = order.finalAmount;
          revenueDate = order.deliveredOn || order.updatedOn || order.createdOn;
        }
      } else {
        if (order.orderedItems.some(item => item.status !== 'cancelled')) {
          shouldInclude = true;
          revenueAmount = order.finalAmount;
          revenueDate = order.createdOn;
        }
      }

      if (shouldInclude) {
        orderCount++;
        totalSales += revenueAmount;
        totalDiscounts += (order.discount || 0);
        totalCoupons += (order.couponDiscount || 0);

        salesArray.push({
          orderId: order.orderId || order._id.toString(),
          amount: revenueAmount,
          discount: order.discount || 0,
          coupon: order.couponDiscount || 0,
          lessPrice: order.orderedItems.reduce((sum, item) => sum + (item.regularPrice * item.quantity), 0) - revenueAmount,
          date: revenueDate,
          paymentMethod: order.paymentMethod,
          items: order.orderedItems.map(item => ({
            name: item.product ? item.product.name : 'Unknown Product',
            quantity: item.quantity,
            regularPrice: item.regularPrice,
            finalPrice: item.finalPrice || item.price
          }))
        });
      }
    }

    const salesData = {
      sales: salesArray,
      totalSales,
      orderCount,
      discounts: totalDiscounts,
      coupons: totalCoupons,
      lessPrices: salesArray.reduce((sum, sale) => sum + sale.lessPrice, 0),
      paymentMethodLogic: true
    };

    if (format === 'pdf') {
      return generatePDF(res, salesData);
    } else if (format === 'excel') {
      return generateExcel(res, salesData);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid format. Use "pdf" or "excel"' 
      });
    }

  } catch (error) {
    console.error('Error downloading sales report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to download sales report',
      error: error.message 
    });
  }
};


const createSaleRecord = async (order) => {
  try {
    const sale = new Sale({
      orderId: order._id,
      amount: order.totalAmount,
      discount: order.discount || 0,
      coupon: order.couponDiscount || 0,
      date: order.orderDate || new Date()
    });
    
    await sale.save();
    return sale;
  } catch (error) {
    console.error('Error creating sale record:', error);
    throw error;
  }
};


const getTopSelling = async (req, res) => {
  try {
    const { type } = req.query;
    
    const matchCondition = {
      paymentStatus: { $ne: 'failed' },
      $or: [
        { 
          paymentMethod: 'cod', 
          'orderedItems.status': 'delivered' 
        },
        { 
          paymentMethod: 'online', 
          paymentStatus: 'completed',
          'orderedItems.status': { $nin: ['cancelled', 'payment_failed'] }
        },
         { 
    paymentMethod: 'wallet', 
    paymentStatus: 'completed',
    'orderedItems.status': { $nin: ['cancelled', 'payment_failed'] }
  },
      ]
    };

    if (type === 'products') {
      const products = await Order.aggregate([
        { $unwind: '$orderedItems' },
        { $match: matchCondition },
        {
          $lookup: {
            from: 'products',
            let: { productId: '$orderedItems.product' },
            pipeline: [
              { 
                $match: { 
                  $expr: { $eq: ['$_id', '$$productId'] },
                  isBlocked: false,
                  status: { $ne: 'Discontinued' }
                } 
              }
            ],
            as: 'productDetails'
          }
        },
        { $match: { 'productDetails.0': { $exists: true } } },
        {
          $lookup: {
            from: 'categories',
            let: { categoryId: { $arrayElemAt: ['$productDetails.category', 0] } },
            pipeline: [
              { 
                $match: { 
                  $expr: { $eq: ['$_id', '$$categoryId'] }
                } 
              }
            ],
            as: 'categoryDetails'
          }
        },
        {
          $group: {
            _id: '$orderedItems.product',
            name: { $first: { $arrayElemAt: ['$productDetails.productName', 0] } },
            soldCount: { $sum: '$orderedItems.quantity' },
            totalRevenue: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
            currentProduct: { $first: { $arrayElemAt: ['$productDetails', 0] } },
            currentCategory: { $first: { $arrayElemAt: ['$categoryDetails', 0] } }
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            productId: '$_id',
            name: 1,
            image: { $arrayElemAt: ['$currentProduct.productImage', 0] },
            category: '$currentCategory.name',
            price: '$currentProduct.salePrice',
            soldCount: 1,
            totalRevenue: 1
          }
        }
      ]);

      const totalRevenue = products.reduce((sum, product) => sum + (product.totalRevenue || 0), 0);
      return res.json({ products, totalRevenue });

    } else if (type === 'categories') {
      const categories = await Order.aggregate([
        { $unwind: '$orderedItems' },
        { $match: matchCondition },
        {
          $lookup: {
            from: 'products',
            let: { productId: '$orderedItems.product' },
            pipeline: [
              { 
                $match: { 
                  $expr: { $eq: ['$_id', '$$productId'] },
                  isBlocked: false,
                  status: { $ne: 'Discontinued' }
                } 
              }
            ],
            as: 'productDetails'
          }
        },
        { $match: { 'productDetails.0': { $exists: true } } },
        {
          $lookup: {
            from: 'categories',
            let: { categoryId: { $arrayElemAt: ['$productDetails.category', 0] } },
            pipeline: [
              { 
                $match: { 
                  $expr: { $eq: ['$_id', '$$categoryId'] }
                } 
              }
            ],
            as: 'categoryDetails'
          }
        },
        {
          $group: {
            _id: { $arrayElemAt: ['$categoryDetails._id', 0] },
            name: { $first: { $arrayElemAt: ['$categoryDetails.name', 0] } },
            soldCount: { $sum: '$orderedItems.quantity' },
            totalRevenue: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
            productCount: { $addToSet: '$orderedItems.product' }
          }
        },
        {
          $project: {
            _id: 0,
            categoryId: '$_id',
            name: 1,
            soldCount: 1,
            totalRevenue: 1,
            productCount: { $size: '$productCount' },
            averagePrice: { $divide: ['$totalRevenue', '$soldCount'] }
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 }
      ]);

      const totalRevenue = categories.reduce((sum, category) => sum + (category.totalRevenue || 0), 0);
      return res.json({ categories, totalRevenue });

    } else if (type === 'brands') {
      const brands = await Order.aggregate([
        { $unwind: '$orderedItems' },
        { $match: matchCondition },
        {
          $lookup: {
            from: 'products',
            let: { productId: '$orderedItems.product' },
            pipeline: [
              { 
                $match: { 
                  $expr: { $eq: ['$_id', '$$productId'] },
                  isBlocked: false,
                  status: { $ne: 'Discontinued' },
                  brand: { $exists: true, $ne: null } 
                } 
              }
            ],
            as: 'productDetails'
          }
        },
        { $match: { 'productDetails.0': { $exists: true } } },
        {
          $group: {
            _id: { $arrayElemAt: ['$productDetails.brand', 0] },
            name: { $first: { $arrayElemAt: ['$productDetails.brand', 0] } },
            soldCount: { $sum: '$orderedItems.quantity' },
            totalRevenue: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
            productCount: { $addToSet: '$orderedItems.product' }
          }
        },
        {
          $project: {
            _id: 0,
            name: 1,
            soldCount: 1,
            totalRevenue: 1,
            productCount: { $size: '$productCount' },
            averagePrice: { $divide: ['$totalRevenue', '$soldCount'] }
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 }
      ]);

      const totalRevenue = brands.reduce((sum, brand) => sum + (brand.totalRevenue || 0), 0);
      return res.json({ brands, totalRevenue });
    }

    return res.status(400).json({ error: 'Invalid type parameter' });

  } catch (error) {
    console.error('Error fetching top selling data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


module.exports = {
  loadSalesPage,
  createSaleRecord,
  getSalesReport,
  getSalesData,
  downloadSalesReport,
  generatePDF,
  generateExcel,
    
  getTopSelling
};