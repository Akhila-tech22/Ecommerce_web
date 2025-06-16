const Wallet = require("../models/walletSchema")
const Transaction = require("../models/transactionSchema")
const User = require("../models/userSchema")
const crypto = require("crypto")
const env = require("dotenv").config()



// Display wallet page with transactions
const getWalletPage = async (req, res) => {
    try {
        const userId = req.session.user; 
        const page = parseInt(req.query.page) || 1;
        const limit = 10; 
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

       
        const availableBalance = user.wallet || 0;  //7700
  
       
        const refundTransactions = await Transaction.find({ 
            userId: userId, 
            purpose: { $in: ['cancellation', 'return'] },
            transactionType: 'credit'
        });
        const refundAmount = refundTransactions.reduce((sum, t) => sum + t.amount, 0);



        // Prepare wallet data
        const wallet = {
            balance: availableBalance,
            refundAmount: refundAmount,
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


module.exports = {
    getWalletPage,
    
};