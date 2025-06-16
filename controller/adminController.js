
const mongoose = require('mongoose')
const bcrypt = require('bcrypt')
const User = require('../models/userSchema')
const Order = require('../models/orderSchema')
const Product = require('../models/productSchema')
const Category = require('../models/categorySchema')




const pageerror = async (req,res) => {
    try {
        res.render('dashboard')
    } catch (error) {
        res.redirect('/pageerror')
    }
}


const loadLogin = (req, res) => {
    if (req.session.admin) {
        return res.redirect("/admin/dashboard");
    }

    res.render("admin-login", { message: null });  // default load
};


const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await User.findOne({ isAdmin: true, email: email });

        if (admin) {
            const passwordMatch = await bcrypt.compare(password, admin.password);
            if (passwordMatch) {
                req.session.admin = admin._id;
                return res.redirect('/admin');
            } else {
                // Incorrect password
                return res.render('admin-login', { message: 'Incorrect password' });
            }
        } else if(!admin && !password){
            
            return res.render('admin-login', { message: 'Please enter Email and Password' });
        } else {
            return res.render('admin-login', { message: 'Admin not found with this email' });
        }
    } catch (error) {
        console.log("Login Error", error);
        return res.redirect('/pageerror');
    }
};





const logout = async (req,res) => {

    try {
        req.session.destroy((error) => {
            if(error) {
                console.log("error destroying session",error);
                return res.redirect('/pageerror')
                
            }
            res.redirect('/admin/login')
        })
    } catch (error) {
        console.log("logout error", error);
        res.redirect('/pageerror')
        
    }
}


const loadDashboard = async (req, res) => {
  if (req.session.admin) {
    try {
      const productCount = await Product.countDocuments({ isBlocked: false })
      const userCount = await User.countDocuments({ isAdmin: false, isBlocked: false })
      const orderCount = await Order.countDocuments()

      const orders = await Order.find({ status: "delivered" })
      const totalRevenue = orders.reduce((total, order) => total + order.finalAmount, 0)

      const topProducts = await getTopSellingProducts()

      const recentOrders = await getRecentOrders()

      const salesData = await getSalesDataHelper("monthly")

      const orderStatusCounts = await getOrderStatusCounts()

      const dashboardData = {
        productCount,
        userCount,
        orderCount,
        totalRevenue,
        topProducts,
        recentOrders,
        salesData: salesData.data,
        salesLabels: salesData.labels,
        orderStatusData: Object.values(orderStatusCounts),
        orderStatusLabels: Object.keys(orderStatusCounts),
      }

      res.render("dashboard", { dashboardData })
    } catch (error) {
      console.error("Dashboard Error:", error)
      res.redirect("/pageerror")
    }
  } else {
    return res.redirect("/admin/login")
  }
}

const getTopSellingProducts = async (limit = 5) => {
  try {
    const topProducts = await Order.aggregate([
      { $match: { status: "delivered" } },
      { $unwind: "$orderedItems" },
      {
        $group: {
          _id: "$orderedItems.product",
          name: { $first: "$orderedItems.productName" },
          soldCount: { $sum: "$orderedItems.quantity" },
          totalSales: { $sum: { $multiply: ["$orderedItems.price", "$orderedItems.quantity"] } },
        },
      },
      { $sort: { soldCount: -1 } },
      { $limit: limit },
    ])

    // Enrich with product details
    const enrichedProducts = await Promise.all(
      topProducts.map(async (product) => {
        const productDetails = await Product.findById(product._id).populate("category")
        return {
          _id: product._id,
          name: product.name,
          category: productDetails?.category?.name || "Uncategorized",
          price: productDetails?.salePrice || 0,
          image: productDetails?.productImage?.[0] || null,
          soldCount: product.soldCount,
          totalSales: product.totalSales,
          brand: productDetails?.brand || "Unknown"
        }
      }),
    )

    return enrichedProducts
  } catch (error) {
    console.error("Error getting top products:", error)
    return []
  }
}

const getRecentOrders = async (limit = 5) => {
  try {
    const recentOrders = await Order.find()
      .sort({ createdOn: -1 })
      .limit(limit)
      .populate('userId', 'name email')

    // Filter out orders that have any item with status 'payment_failed'
    const filteredOrders = recentOrders.filter(order =>
      !order.orderedItems.some(item => item.status === 'payment_failed')
    )

    // Map orders with customer details
    const ordersWithCustomers = filteredOrders.map(order => ({
      ...order.toObject(),
      customerName: order.userId ? `${order.userId.name}` : "Unknown Customer",
      customerEmail: order.userId ? order.userId.email : "Unknown Email"
    }))

    return ordersWithCustomers
  } catch (error) {
    console.error("Error getting recent orders:", error)
    return []
  }
}

const getSalesDataHelper = async (period = "yearly") => {
  try {
    const now = new Date()
    const labels = []
    const data = []

    if (period === "weekly") {
      // Last 7 days
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now)
        date.setDate(date.getDate() - i)

        const dayStart = new Date(date.setHours(0, 0, 0, 0))
        const dayEnd = new Date(date.setHours(23, 59, 59, 999))

        const dayOrders = await Order.find({
          createdOn: { $gte: dayStart, $lte: dayEnd },
          status: "delivered",
        })

        const daySales = dayOrders.reduce((total, order) => total + order.finalAmount, 0)

        labels.push(date.toLocaleDateString("en-US", { weekday: "short" }))
        data.push(daySales)
      }
    } else if (period === "monthly") {
      // Last 6 months
      for (let i = 5; i >= 0; i--) {
        const date = new Date(now)
        date.setMonth(date.getMonth() - i)

        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)

        const monthOrders = await Order.find({
          createdOn: { $gte: monthStart, $lte: monthEnd },
          status: "delivered",
        })

        const monthSales = monthOrders.reduce((total, order) => total + order.finalAmount, 0)

        labels.push(date.toLocaleDateString("en-US", { month: "short", year: "numeric" }))
        data.push(monthSales)
      }
    } else if (period === "yearly") {
      // Last 5 years
      for (let i = 4; i >= 0; i--) {
        const year = now.getFullYear() - i

        const yearStart = new Date(year, 0, 1)
        const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999)

        const yearOrders = await Order.find({
          createdOn: { $gte: yearStart, $lte: yearEnd },
          status: "delivered",
        })

        const yearSales = yearOrders.reduce((total, order) => total + order.finalAmount, 0)

        labels.push(year.toString())
        data.push(yearSales)
      }
    }

    return { labels, data }
  } catch (error) {
    console.error("Error getting sales data:", error)
    return { labels: [], data: [] }
  }
}

const getOrderStatusCounts = async () => {
  try {
    const statusCounts = {
      Delivered: 0,
      Pending: 0,
      Confirmed: 0,
      Shipped: 0,
      Cancelled: 0,
      'Return Requested': 0,
      Returning: 0,
      Returned: 0,
    }

    const orders = await Order.find()

    orders.forEach((order) => {
      switch(order.status.toLowerCase()) {
        case "delivered":
          statusCounts["Delivered"]++
          break
        case "pending":
          statusCounts["Pending"]++
          break
        case "confirmed":
          statusCounts["Confirmed"]++
          break
        case "shipped":
          statusCounts["Shipped"]++
          break
        case "cancelled":
          statusCounts["Cancelled"]++
          break
        case "return_requested":
          statusCounts["Return Requested"]++
          break
        case "returning":
          statusCounts["Returning"]++
          break
        case "returned":
          statusCounts["Returned"]++
          break
        default:
          // Handle any other status
          break
      }
    })

    return statusCounts
  } catch (error) {
    console.error("Error getting order status counts:", error)
    return { 
      Delivered: 0, 
      Pending: 0, 
      Confirmed: 0,
      Shipped: 0, 
      Cancelled: 0, 
      'Return Requested': 0,
      Returning: 0,
      Returned: 0 
    }
  }
}

const getTopSelling = async (req, res) => {
  try {
    const { type } = req.query

    if (type === "categories") {
      // Get top selling categories
      const topCategories = await Order.aggregate([
        { $match: { status: "delivered" } },
        { $unwind: "$orderedItems" },
        {
          $lookup: {
            from: "products",
            localField: "orderedItems.product",
            foreignField: "_id",
            as: "productDetails",
          },
        },
        { $unwind: "$productDetails" },
        {
          $lookup: {
            from: "categories",
            localField: "productDetails.category",
            foreignField: "_id",
            as: "categoryDetails",
          },
        },
        { $unwind: "$categoryDetails" },
        {
          $group: {
            _id: "$categoryDetails._id",
            name: { $first: "$categoryDetails.name" },
            productCount: { $addToSet: "$productDetails._id" },
            soldCount: { $sum: "$orderedItems.quantity" },
            totalSales: { $sum: { $multiply: ["$orderedItems.price", "$orderedItems.quantity"] } },
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            productCount: { $size: "$productCount" },
            soldCount: 1,
            totalSales: 1,
          },
        },
        { $sort: { soldCount: -1 } },
        { $limit: 10 },
      ])

      res.json({ categories: topCategories })
    } else {
      // Get top selling products
      const topProducts = await Order.aggregate([
        { $match: { status: "delivered" } },
        { $unwind: "$orderedItems" },
        {
          $group: {
            _id: "$orderedItems.product",
            name: { $first: "$orderedItems.productName" },
            soldCount: { $sum: "$orderedItems.quantity" },
            totalSales: { $sum: { $multiply: ["$orderedItems.price", "$orderedItems.quantity"] } },
          },
        },
        { $sort: { soldCount: -1 } },
        { $limit: 10 },
      ])

      // Enrich with product details
      const enrichedProducts = await Promise.all(
        topProducts.map(async (product) => {
          const productDetails = await Product.findById(product._id).populate("category")
          return {
            _id: product._id,
            name: product.name,
            category: productDetails?.category?.name || "Uncategorized",
            brand: productDetails?.brand || "Unknown",
            price: productDetails?.salePrice || 0,
            regularPrice: productDetails?.regularPrice || 0,
            image: productDetails?.productImage?.[0] || null,
            soldCount: product.soldCount,
            totalSales: product.totalSales,
            status: productDetails?.status || "unknown"
          }
        }),
      )

      res.json({ products: enrichedProducts })
    }
  } catch (error) {
    console.error("Error in getTopSelling API:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

const getSalesData = async (req, res) => {
  try {
    const { period = "monthly" } = req.query

    const salesData = await getSalesDataHelper(period)
    res.json(salesData)
  } catch (error) {
    console.error("Error in getSalesData API:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

// Additional helper functions you might want to add

const getRevenueTrends = async (req, res) => {
  try {
    const { period = "monthly" } = req.query
    
    const salesData = await getSalesDataHelper(period)
    
    // Calculate growth percentage
    const currentPeriod = salesData.data[salesData.data.length - 1] || 0
    const previousPeriod = salesData.data[salesData.data.length - 2] || 0
    
    const growthPercentage = previousPeriod === 0 ? 0 : 
      ((currentPeriod - previousPeriod) / previousPeriod) * 100
    
    res.json({
      ...salesData,
      currentPeriodRevenue: currentPeriod,
      previousPeriodRevenue: previousPeriod,
      growthPercentage: Math.round(growthPercentage * 100) / 100
    })
  } catch (error) {
    console.error("Error getting revenue trends:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

const getCustomerStats = async (req, res) => {
  try {
    const totalCustomers = await User.countDocuments({ isAdmin: false, isBlocked: false })
    const newCustomersThisMonth = await User.countDocuments({
      isAdmin: false,
      isBlocked: false,
      createdOn: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    })
    
    const repeatCustomers = await Order.aggregate([
      { $group: { _id: "$userId", orderCount: { $sum: 1 } } },
      { $match: { orderCount: { $gt: 1 } } },
      { $count: "repeatCustomers" }
    ])
    
    res.json({
      totalCustomers,
      newCustomersThisMonth,
      repeatCustomers: repeatCustomers[0]?.repeatCustomers || 0
    })
  } catch (error) {
    console.error("Error getting customer stats:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

module.exports = {
  loadDashboard,
  getTopSellingProducts,
  getRecentOrders,
  getSalesDataHelper,
  getOrderStatusCounts,
  getTopSelling,
  getSalesData,
  getRevenueTrends,
  getCustomerStats,
  loadLogin, login, pageerror, logout
}

