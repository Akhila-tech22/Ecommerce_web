const express = require("express");
const path = require('path');
const app = express();
require('dotenv').config();
const db = require('./config/db');
const session = require('express-session');
const passport = require('./config/passport'); // Passport config
const userRouter = require('./routes/userRouter');
const adminRouter = require('./routes/adminRouter');
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');

db(); // Connect to DB

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/upload/re-image', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use('/karma-master/uploads/product-images', express.static(path.join(__dirname, 'karma-master', 'uploads', 'product-images')));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 72 * 60 * 60 * 1000
    }
}));

// Caching disabled
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');
app.set("views", [path.join(__dirname, 'views/user'), path.join(__dirname, 'views/admin')]);
app.use(express.static(path.join(__dirname, 'karma-master')));

//  Use Routers
app.use('/', userRouter);
app.use('/user', userRouter);
app.use('/admin', adminRouter);

//  Error handling middleware 
app.use((err, req, res, next) => {
    console.error(' Error:', err.stack);
    res.status(err.status || 500);
    res.render('error', {
        message: err.message || 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

app.listen(process.env.PORT, () => {
    console.log("Server running on port", process.env.PORT);
});

module.exports = app;
