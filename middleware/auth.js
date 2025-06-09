const User = require("../models/userSchema");


const userAuth = (req, res, next) => {
    if (req.session.user) {
      User.findById(req.session.user)
        .then((user) => {
          if (user && !user.isBlocked) {
            next()
          } else {
            delete req.session.user
            res.redirect("/login")
          }
        })
        .catch((error) => {
          console.log("User Auth Error", error)
          res.status(500).send("Internal Server Error")
        })
    } else {
      res.redirect("/login")
    }
  }




  const adminAuth = (req, res, next) => {
    if (req.session.admin) {
        User.findById(req.session.admin)
        .then(admin => {
            if (admin && admin.isAdmin) { 
                next();
            } else {
                req.session.destroy();  // Clear invalid session
                res.redirect('/admin/login');
            }
        })
        .catch(error => {
            console.error("Admin Auth Error", error);
            res.redirect('/admin/login');
        });
    } else {
        res.redirect('/admin/login');
    }
};

const ajaxAuth = (req, res, next) => {
  if (req.session.user) {
    User.findById(req.session.user)
      .then((user) => {
        if (user && !user.isBlocked) {
          next();
        } else {
          delete req.session.user;
          res.status(401).json({ 
            status: false, 
            message: "User is blocked or not found" 
          });
        }
      })
      .catch((error) => {
        console.log("Ajax Auth Error", error);
        res.status(500).json({ 
          status: false, 
          message: "Internal server error" 
        });
      });
  } else {
    res.status(401).json({ 
      status: false, 
      message: "User not logged in" 
    });
  }
};



module.exports = {userAuth, adminAuth, ajaxAuth}