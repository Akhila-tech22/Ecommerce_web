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
        // Default to current month if no reportType specified
        query.createdOn = {
          $gte: new Date(now.getFullYear(), now.getMonth(), 1),
          $lt: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        };
    }

    // Only include delivered orders
    query.status = 'delivered';

    // Fetch orders with populated product details
    const orders = await Order.find(query)
      .populate('orderedItems.product')
      .sort({ createdOn: 1 });
    
    let totalRegularPrice = 0;
    let totalFinalAmount = 0;
    let totalDiscounts = 0;
    let totalCoupons = 0;

    const sales = orders.map(order => {
      // Calculate regular price considering quantity
      const orderRegularPrice = order.orderedItems.reduce((sum, item) => {
        return sum + (item.regularPrice * item.quantity);
      }, 0);

      // Calculate final amount (excluding delivery charge if applicable)
      const deliveryCharge = order.deliveryCharge || 50;
      const finalAmountWithoutDelivery = Math.max(0, order.finalAmount - deliveryCharge);
      
      // Calculate actual discount
      const actualDiscount = Math.max(0, orderRegularPrice - finalAmountWithoutDelivery);
      
      // Calculate coupon discount
      const couponDiscount = order.couponApplied && order.couponDiscount ? 
        order.couponDiscount : 0;
      
      // Update totals
      totalRegularPrice += orderRegularPrice;
      totalFinalAmount += finalAmountWithoutDelivery;
      totalDiscounts += (order.discount || 0);
      totalCoupons += couponDiscount;
      
      return {
        orderId: order.orderId || order._id.toString(),
        amount: finalAmountWithoutDelivery,
        discount: order.discount || 0,
        coupon: couponDiscount,
        lessPrice: actualDiscount,
        date: order.createdOn,
        items: order.orderedItems.map(item => ({
          name: item.product ? item.product.name : 'Unknown Product',
          quantity: item.quantity,
          regularPrice: item.regularPrice,
          finalPrice: item.finalPrice || item.price
        }))
      };
    });
    
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

    // Handle different output formats
    if (format === 'pdf') {
      return generatePDF(res, salesData);
    } else if (format === 'excel') {
      return generateExcel(res, salesData);
    }

    // Render EJS template
    res.render('admin/sales-report', { salesData });
    
  } catch (error) {
    console.error('Error in loadSalesPage:', error);
    res.status(500).render('admin/pageerror', { 
      message: 'Error loading sales report', 
      error: error.message 
    });
  }
};

const generatePDF = async (res, salesData) => {
  try {
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=sales-report.pdf");

    doc.pipe(res);

    // PDF Header
    doc.fontSize(20).text("Sales Report", { align: "center" });
    doc.moveDown();
    
    // Report period info
    if (salesData.startDate && salesData.endDate) {
      doc.fontSize(12).text(`Period: ${salesData.startDate} to ${salesData.endDate}`, { align: "center" });
    } else {
      doc.fontSize(12).text(`Report Type: ${salesData.reportType}`, { align: "center" });
    }
    doc.moveDown();

    // Summary section
    doc.fontSize(16).text("Summary", { underline: true });
    doc.fontSize(12)
      .text(`Total Sales: Rs. ${salesData.totalSales.toLocaleString()}`)
      .text(`Total Orders: ${salesData.orderCount}`)
      .text(`Total Discounts: Rs. ${salesData.discounts.toLocaleString()}`)
      .text(`Total Coupons: Rs. ${salesData.coupons.toLocaleString()}`)
      .text(`Total Price Reduction: Rs. ${salesData.lessPrices.toLocaleString()}`);

    doc.moveDown();

    // Detailed sales table
    doc.fontSize(14).text("Detailed Sales", { underline: true });
    doc.moveDown();

    // Table headers
    let yPosition = doc.y;
    const tableTop = yPosition;
    
    doc.fontSize(10);
    doc.text("Date", 50, yPosition);
    doc.text("Order ID", 120, yPosition);
    doc.text("Amount", 220, yPosition);
    doc.text("Discount", 280, yPosition);
    doc.text("Coupon", 340, yPosition);
    doc.text("Items", 400, yPosition);

    // Draw header line
    doc.moveTo(50, yPosition + 15)
       .lineTo(550, yPosition + 15)
       .stroke();

    yPosition += 25;

    // Table data
    salesData.sales.forEach((sale, index) => {
      // Check if we need a new page
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
        
        // Redraw headers on new page
        doc.fontSize(10);
        doc.text("Date", 50, yPosition);
        doc.text("Order ID", 120, yPosition);
        doc.text("Amount", 220, yPosition);
        doc.text("Discount", 280, yPosition);
        doc.text("Coupon", 340, yPosition);
        doc.text("Items", 400, yPosition);
        
        doc.moveTo(50, yPosition + 15)
           .lineTo(550, yPosition + 15)
           .stroke();
        yPosition += 25;
      }

      const saleDate = new Date(sale.date).toLocaleDateString();
      const shortOrderId = sale.orderId.toString().slice(-12);
      
      doc.text(saleDate, 50, yPosition);
      doc.text(shortOrderId, 120, yPosition);
      doc.text(`Rs. ${sale.amount.toLocaleString()}`, 220, yPosition);
      doc.text(`Rs. ${sale.discount.toLocaleString()}`, 280, yPosition);
      doc.text(`Rs. ${sale.coupon.toLocaleString()}`, 340, yPosition);
      doc.text(sale.items.length.toString(), 400, yPosition);

      yPosition += 20;
    });

    doc.end();
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

const generateExcel = async (res, salesData) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sales Report');
    
    // Add title and summary
    worksheet.addRow(['Sales Report']);
    worksheet.addRow([]);
    worksheet.addRow(['Summary']);
    worksheet.addRow(['Total Sales', `Rs. ${salesData.totalSales.toLocaleString()}`]);
    worksheet.addRow(['Total Orders', salesData.orderCount]);
    worksheet.addRow(['Total Discounts', `Rs. ${salesData.discounts.toLocaleString()}`]);
    worksheet.addRow(['Total Coupons', `Rs. ${salesData.coupons.toLocaleString()}`]);
    worksheet.addRow(['Total Price Reduction', `Rs. ${salesData.lessPrices.toLocaleString()}`]);
    worksheet.addRow([]);
    
    // Add detailed sales header
    worksheet.addRow(['Detailed Sales']);
    worksheet.addRow(['Date', 'Order ID', 'Amount', 'Discount', 'Coupon', 'Items Count']);
    
    // Add sales data
    salesData.sales.forEach(sale => {
      worksheet.addRow([
        new Date(sale.date).toLocaleDateString(),
        sale.orderId.toString(),
        `Rs. ${sale.amount.toLocaleString()}`,
        `Rs. ${sale.discount.toLocaleString()}`,
        `Rs. ${sale.coupon.toLocaleString()}`,
        sale.items.length
      ]);
    });
    
    // Style the worksheet
    worksheet.getRow(1).font = { bold: true, size: 16 };
    worksheet.getRow(3).font = { bold: true };
    worksheet.getRow(10).font = { bold: true };
    worksheet.getRow(11).font = { bold: true };
    
    // Auto-fit columns
    worksheet.columns.forEach(column => {
      column.width = 15;
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=sales-report.xlsx');
    
    await workbook.xlsx.write(res);
    
  } catch (error) {
    console.error('Error generating Excel:', error);
    res.status(500).json({ error: 'Failed to generate Excel file' });
  }
};

const createSaleRecord = async (order) => {
  try {
    // Check if sale record already exists
    const existingSale = await Sale.findOne({ orderId: order._id });
    if (existingSale) {
      return existingSale;
    }

    const sale = new Sale({
      orderId: order._id,
      amount: order.finalAmount || order.totalAmount,
      discount: order.discount || 0,
      coupon: order.couponDiscount || 0,
      date: order.createdOn || order.orderDate || new Date()
    });
    
    await sale.save();
    return sale;
  } catch (error) {
    console.error('Error creating sale record:', error);
    throw error;
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

    // Build date query
    const dateQuery = {
      createdOn: {
        $gte: new Date(startDate),
        $lte: new Date(endDate + 'T23:59:59.999Z')
      },
      status: { $nin: ['cancelled', 'pending'] } // Exclude cancelled and pending orders
    };

    // Query orders within date range
    const orders = await Order.find(dateQuery)
      .populate('userId', 'name email')
      .populate('orderedItems.product', 'name category regularPrice')
      .sort({ createdOn: -1 });

    // Calculate statistics
    const stats = {
      totalOrders: orders.length,
      totalSalesAmount: orders.reduce((sum, order) => {
        const regularPrice = order.orderedItems.reduce((itemSum, item) => {
          return itemSum + (item.regularPrice * item.quantity);
        }, 0);
        return sum + regularPrice;
      }, 0),
      totalDiscount: orders.reduce((sum, order) => {
        const discount = (order.discount || 0) + (order.couponDetails?.discountAmount || 0);
        return sum + discount;
      }, 0),
      netRevenue: orders.reduce((sum, order) => sum + (order.finalAmount || 0), 0)
    };

    // Format orders for display
    const formattedOrders = orders.map(order => ({
      _id: order._id,
      orderId: order.orderId || order._id.toString(),
      customerName: order.userId?.name || order.shippingAddress?.fullName || 'Unknown',
      products: order.orderedItems || order.products || [],
      originalAmount: order.orderedItems.reduce((sum, item) => sum + (item.regularPrice * item.quantity), 0),
      discountAmount: (order.discount || 0) + (order.couponDetails?.discountAmount || 0),
      couponCode: order.couponDetails?.couponCode || 'N/A', // Fixed: Access nested coupon code
      finalAmount: order.finalAmount || 0,
      status: order.status,
      createdAt: order.createdOn // Fixed: Map createdOn to createdAt for EJS template
    }));

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
        // Last 7 days
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = { createdOn: { $gte: weekStart } };
        groupBy = {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdOn" } },
          total: { $sum: "$finalAmount" },
          count: { $sum: 1 }
        };
        break;
        
      case 'monthly':
        // Last 12 months
        const monthStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        dateFilter = { createdOn: { $gte: monthStart } };
        groupBy = {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdOn" } },
          total: { $sum: "$finalAmount" },
          count: { $sum: 1 }
        };
        break;
        
      case 'yearly':
        // Last 5 years
        const yearStart = new Date(now.getFullYear() - 4, 0, 1);
        dateFilter = { createdOn: { $gte: yearStart } };
        groupBy = {
          _id: { $dateToString: { format: "%Y", date: "$createdOn" } },
          total: { $sum: "$finalAmount" },
          count: { $sum: 1 }
        };
        break;
    }

    const salesData = await Order.aggregate([
      { $match: { ...dateFilter, status: { $nin: ['cancelled', 'pending'] } } },
      { $group: groupBy },
      { $sort: { _id: 1 } }
    ]);

    // Format data for chart
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

// Additional function that might be missing
const downloadSalesReport = async (req, res) => {
  try {
    const { format, startDate, endDate } = req.body;
    
    if (!format || !startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'Format, start date, and end date are required' 
      });
    }

    // Get filtered data
    const dateQuery = {
      createdOn: {
        $gte: new Date(startDate),
        $lte: new Date(endDate + 'T23:59:59.999Z')
      },
      status: { $nin: ['cancelled', 'pending'] }
    };

    const orders = await Order.find(dateQuery)
      .populate('userId', 'name email')
      .populate('orderedItems.product', 'name category regularPrice')
      .sort({ createdOn: -1 });

    // Calculate summary stats
    const stats = {
      totalOrders: orders.length,
      totalSalesAmount: orders.reduce((sum, order) => {
        const regularPrice = order.orderedItems.reduce((itemSum, item) => {
          return itemSum + (item.regularPrice * item.quantity);
        }, 0);
        return sum + regularPrice;
      }, 0),
      totalDiscount: orders.reduce((sum, order) => {
        const discount = (order.discount || 0) + (order.couponDiscount || 0);
        return sum + discount;
      }, 0),
      netRevenue: orders.reduce((sum, order) => sum + (order.finalAmount || 0), 0)
    };

    // Prepare sales data for export
    const salesData = {
      sales: orders.map(order => ({
        orderId: order.orderId || order._id.toString(),
        amount: order.finalAmount || 0,
        discount: order.discount || 0,
        coupon: order.couponDiscount || 0,
        lessPrice: order.orderedItems.reduce((sum, item) => sum + (item.regularPrice * item.quantity), 0) - (order.finalAmount || 0),
        date: order.createdOn,
        items: order.orderedItems.map(item => ({
          name: item.product ? item.product.name : 'Unknown Product',
          quantity: item.quantity,
          regularPrice: item.regularPrice,
          finalPrice: item.finalPrice || item.price
        }))
      })),
      totalSales: stats.netRevenue,
      orderCount: stats.totalOrders,
      discounts: stats.totalDiscount,
      coupons: orders.reduce((sum, order) => sum + (order.couponDiscount || 0), 0),
      lessPrices: stats.totalSalesAmount - stats.netRevenue
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

module.exports = {
  loadSalesPage,
  createSaleRecord,
  getSalesReport,
  getSalesData,
  downloadSalesReport,
  generatePDF,
  generateExcel
};