const mongoose = require('mongoose');
const {Schema} = mongoose;

const userSchema = new Schema({
    name:{
        type: String,
        required: true
    },
    email:{
        type: String,
        required: true,
        unique: true
    },
    phone:{
        type: String,
        required: false,
        unique: false,
        sparse: true,
        default: null
    },
    googleId:{
        type: String,
    },
    password:{
        type: String,
        required: false,
    },
    username: {
        type:String,
        required:false
    },
    isBlocked:{
        type: Boolean,
        default: false     
    },
    isAdmin:{
        type: Boolean,
        default: false     
    },
    profilePicture:{
        type:String,
        required:false
    },
    // UPDATED CART STRUCTURE
    cart:[{
        productId: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        size: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            default: 1,
            min: 1,
            max: 5
        },
        price: {
            type: Number,
            required: true
        }
    }],
    wallet:{
        type: Number,
        default: 0
    },
    wishlist:[{
    productId: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    size: {
        type: String,
        required: true
    },
    addedOn: {
        type: Date,
        default: Date.now
    }
}],
    orderHistory:[{
        type: Schema.Types.ObjectId,
        ref: 'Order'
    }],
    createdOn:{
        type: Date,
        default: Date.now
    },
    referalCode:{
        type: String,
    },
    redeemed:{
        type: Boolean,
    },
    redeemedUsers:[{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }],
    searchHistory:[{
        category:{
            type: Schema.Types.ObjectId,
            ref: 'Category'
        },
        brand:{
            type: String
        },
        searchOn:{
            type: Date,
            default: Date.now
        }
    }]
})

const User = mongoose.model('User', userSchema);
module.exports = User;