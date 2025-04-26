


const loadHome = async (req, res) => {
    try {
        return res.render("home");
    } catch (error) {
        console.log("something error:", error.message);  // 🔥 see what went wrong
        res.status(500).send("server error");
    }
};

const pageNotFound = async (req,res) => {
    try {
        res.render('page-404')
    }catch(error) {
        res.redirect("/pageNotFound")
    }
}

module.exports = {loadHome, pageNotFound}