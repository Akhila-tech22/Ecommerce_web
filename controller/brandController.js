const Brand = require('../models/brandSchema');
const Product = require('../models/productSchema');


const getBrandPage = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 6;               // You can increase limit if you want to see more brands per page
    const skip = (page - 1) * limit;

    // Find brands sorted by newest first, paginate
    const brandData = await Brand.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total brand count for pagination
    const totalBrands = await Brand.countDocuments();
    const totalPages = Math.ceil(totalBrands / limit);

    res.render('brands', {
      data: brandData,
      currentPage: page,
      totalPages,
      totalBrands,
    });
  } catch (error) {
    console.error('Error fetching brand data:', error);
    res.redirect('/pageerror');
  }
};

const addBrand = async (req, res) => {
  try {
    const brandName = req.body.name.trim();
    const existingBrand = await Brand.findOne({ brandName: brandName });

    if (!existingBrand) {
      // multer adds file info to req.file
      const image = req.file ? req.file.filename : null;

      if (!image) {
        // No image uploaded, handle error or redirect with message
        return res.redirect('/admin/brands'); // You can add error flash message if needed
      }

      const newBrand = new Brand({
        brandName,
        brandImage: [image], // Save as array (even if single image)
      });

      await newBrand.save();
    }
    // If brand exists, just ignore or handle accordingly (maybe redirect with error message)
    res.redirect('/admin/brands');
  } catch (error) {
    console.error('Add brand error:', error);
    res.redirect('/pageerror');
  }
};

const blockBrand = async (req, res) => {
  try {
    const id = req.query.id;
    await Brand.updateOne({ _id: id }, { $set: { isBlocked: true } });
    res.redirect('/admin/brands');
  } catch (error) {
    console.error('Block brand error:', error);
    res.redirect('/pageerror');
  }
};

const unBlockBrand = async (req, res) => {
  try {
    const id = req.query.id;
    await Brand.updateOne({ _id: id }, { $set: { isBlocked: false } });
    res.redirect('/admin/brands');
  } catch (error) {
    console.error('Unblock brand error:', error);
    res.redirect('/pageerror');
  }
};

const deleteBrand = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).redirect('/pageerror');
    }

    await Brand.deleteOne({ _id: id });
    res.redirect('/admin/brands');
  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).redirect('/pageerror');
  }
};

module.exports = {
  getBrandPage,
  addBrand,
  blockBrand,
  unBlockBrand,
  deleteBrand,
};



