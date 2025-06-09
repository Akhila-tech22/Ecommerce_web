const Wallet = require("../models/walletSchema")
const Transaction = require("../models/transactionSchema")
const User = require("../models/userSchema")
const crypto = require("crypto")
const env = require("dotenv").config()



// Display wallet page with transactions
const getWalletPage = async (req, res) => {
    try {
        const userId = req.session.user; // or however you get the user ID
        const page = parseInt(req.query.page) || 1;
        const limit = 10; // Number of transactions per page
        const skip = (page - 1) * limit;

        // Get user data
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).render('error', { message: 'User not found' });
        }

        // Initialize wallet if it doesn't exist
        if (typeof user.wallet !== 'number') {
            user.wallet = 0;
            await user.save();
        }

        // Get total count of transactions for pagination
        const totalTransactions = await Transaction.countDocuments({ userId: userId });
        const totalPages = Math.ceil(totalTransactions / limit);

        // Fetch transactions with pagination, sorted by most recent first
        const transactions = await Transaction.find({ userId: userId })
            .sort({ createdAt: -1 }) // Most recent first
            .skip(skip)
            .limit(limit);

        // Calculate wallet statistics
        // 1. Available Balance: Current wallet balance
        const availableBalance = user.wallet || 0;

        // 2. Refunded Amount: Total amount credited from cancellations and returns
        const refundTransactions = await Transaction.find({ 
            userId: userId, 
            purpose: { $in: ['cancellation', 'return'] }, // Only cancellations and returns
            transactionType: 'credit'
        });
        const refundAmount = refundTransactions.reduce((sum, t) => sum + t.amount, 0);

        // 3. Total Debited: Total amount spent from wallet for purchases
        const debitTransactions = await Transaction.find({ 
            userId: userId, 
            transactionType: 'debit',
            purpose: 'purchase' // Only actual purchases, not refunds
        });
        const totalDebited = debitTransactions.reduce((sum, t) => sum + t.amount, 0);

        // Prepare wallet data
        const wallet = {
            balance: availableBalance,
            refundAmount: refundAmount, // Show total refunded amount
            totalDebited: totalDebited  // Show total spent from wallet
        };

     
        res.render('wallet', {
            user: user,
            wallet: wallet,
            transactions: transactions,
            currentPage: page,
            totalPages: totalPages
        });

    } catch (error) {
        console.error('Error in getWalletPage:', error);
        res.status(500).render('error', { message: 'Internal server error' });
    }
};

// Alternative: If you want "Total Debited" to show refunded amounts instead
const getWalletPageRefundAsDebit = async (req, res) => {
     try {
        console.log("➡️ /addToCartFromWishList called");
        console.log("Body:", req.body);
        console.log("Session:", req.session.user);

        const { productId, size } = req.body;
        const userId = req.session.user;

        if (!userId) {
            return res.status(401).json({ success: false, message: "User not logged in" });
        }

        const user = await User.findById(userId);

        // Optional: check if already in cart
        const alreadyInCart = user.cart.some(item =>
            item.productId.equals(productId) && item.size === size
        );

        if (alreadyInCart) {
            return res.status(400).json({ success: false, message: "Item already in cart" });
        }

        // Fetch product price
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        user.cart.push({
            productId,
            size,
            price: product.price
        });

        await user.save();

        console.log("🛒 Updated Cart:", user.cart);

        res.json({ success: true });

    } catch (error) {
        console.error("Error in addToCartFromWishlist:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = {
    getWalletPage,
    getWalletPageRefundAsDebit
};