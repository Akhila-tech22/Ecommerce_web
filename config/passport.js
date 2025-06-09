const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/userSchema');
require('dotenv').config();

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: 'http://localhost:3000/auth/google/callback'
},
async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
            if (user.isBlocked) {
                // Prevent login if blocked
                return done(null, false, { message: 'User is blocked by admin' });
            }
            return done(null, user);
        } else {
            const newUser = new User({
                name: profile.displayName,
                email: profile.emails[0].value,
                googleId: profile.id
            });
            await newUser.save();
            return done(null, newUser);
        }
    } catch (err) {
        return done(err, null);
    }
}));


passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    User.findById(id)
        .then(user => done(null, user))
        .catch(err => done(err, null));
});

module.exports = passport;
