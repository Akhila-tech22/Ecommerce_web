const PDFDocument = require('pdfkit');
const fs = require('fs');

function generateInvoice(data, filepath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // Header Section
    doc.fontSize(24).font('Helvetica-Bold').text('karma', 50, 50);
    doc.fontSize(10).fillColor('gray').text('www.karma.com', 450, 50, { align: 'right' });
    
    // Add a subtle line separator
    doc.strokeColor('#E0E0E0').lineWidth(1)
       .moveTo(50, 80).lineTo(550, 80).stroke();

    // Invoice Details Section (Left side)
    doc.fillColor('black').fontSize(10);
    doc.text(`Invoice No.:`, 50, 100);
    doc.font('Helvetica-Bold').text(`${data.orderId}`, 120, 100);
    
    doc.font('Helvetica').text(`Date:`, 50, 115);
    doc.font('Helvetica-Bold').text(`${data.invoiceDate}`, 120, 115);

    // Order Status Section (Right side)
    doc.font('Helvetica').text(`Order Status:`, 350, 100);
    doc.font('Helvetica-Bold').text(`${data.status.toUpperCase()}`, 420, 100);
    
    doc.font('Helvetica').text(`Payment Method:`, 350, 115);
    doc.font('Helvetica-Bold').text(`${data.payment.method}`, 450, 115);

    // Bill To Section
    const { name, address, phone } = data.customer;
    doc.font('Helvetica-Bold').text('Bill To:', 50, 150);
    doc.font('Helvetica').fontSize(10);
    doc.text(name, 50, 165);
    doc.text(name, 50, 180); // Duplicate name as shown in image
    doc.text(`${address.city}`, 50, 195);
    doc.text(`${address.state}`, 50, 210);
    doc.text(`${address.pincode}`, 50, 225);
    doc.text(`Landmark: NIL`, 50, 240);
    doc.text(`Phone: ${phone}`, 50, 255);
    doc.text(`Alt Phone: ${phone}748`, 50, 270); // Adding alt phone as shown

    // Payment Verification Section
    doc.fillColor('blue').fontSize(12).font('Helvetica-Bold')
       .text('PAYMENT VERIFICATION', 50, 310);
    doc.fillColor('green').fontSize(10).font('Helvetica')
       .text('Status:', 50, 330);
    doc.font('Helvetica-Bold').text('Paid', 90, 330);

    doc.fillColor('black').font('Helvetica')
       .text(`Order ID: ${data.orderId}`, 250, 330);

    // Table Header
    const tableTop = 370;
    doc.fillColor('black').fontSize(10).font('Helvetica-Bold');
    
    // Table headers with exact positioning
    doc.text('Product Name', 50, tableTop);
    doc.text('Qty', 270, tableTop);
    doc.text('Price', 320, tableTop);
    doc.text('Total', 370, tableTop);
    doc.text('Status', 420, tableTop);
    doc.text('Refund', 490, tableTop);

    // Table content
    let currentY = tableTop + 20;
    doc.font('Helvetica').fontSize(10);
    
    data.orderedItems.forEach((item, index) => {
      // Product name (truncate if too long)
      const productName = item.productName.length > 25 ? 
        item.productName.substring(0, 25) + '...' : item.productName;
      doc.text(productName, 50, currentY);
      
      // Quantity
      doc.text(item.qty.toString(), 270, currentY);
      
      // Price
      doc.text(`₹${item.price}`, 320, currentY);
      
      // Total
      doc.text(`₹${item.total}`, 370, currentY);
      
      // Status with color coding
      if (item.status === 'CANCELLED') {
        doc.fillColor('red').text(item.status, 420, currentY);
      } else if (item.status === 'RETURNED') {
        doc.fillColor('red').text(item.status, 420, currentY);
      } else if (item.status === 'PROCESSING') {
        doc.fillColor('orange').text(item.status, 420, currentY);
      } else if (item.status === 'DELIVERED') {
        doc.fillColor('green').text(item.status, 420, currentY);
      } else {
        doc.fillColor('black').text(item.status, 420, currentY);
      }
      
      // Smart Refund Display
      doc.fillColor('black');
      if (item.refund && item.refund > 0) {
        doc.fillColor('red').text(`₹${item.refund.toFixed(2)}`, 490, currentY);
      } else {
        doc.text('-', 490, currentY);
      }
      
      currentY += 20;
    });

    // Summary Section
    const summaryStartY = currentY + 20;
    let summaryLineY = summaryStartY;
    
    // Get shipping charge and coupon info
    const shippingCharge = data.debugInfo?.deliveryCharge || 50;
    const discount = data.debugInfo?.discount || 0;
    const couponApplied = data.debugInfo?.couponApplied || data.coupon || false;
    const couponCode = data.debugInfo?.couponCode || data.couponCode || '';
    
    doc.fillColor('black').fontSize(10).font('Helvetica');
    
    // Show subtotal (items only)
    doc.text('Subtotal:', 420, summaryLineY);
    doc.text(`₹${data.subtotal.toFixed(2)}`, 490, summaryLineY);
    summaryLineY += 15;
    
    // Show shipping charge
    doc.text('Shipping Charge:  ', 420, summaryLineY);
    doc.text(`₹${shippingCharge.toFixed(2)}`, 490, summaryLineY);
    summaryLineY += 15;
    
    // Show coupon applied if applicable
    if (couponApplied && discount > 0) {
      doc.fillColor('blue');
      const couponText = couponCode ? `Coupon Applied (${couponCode}):` : 'Coupon Applied:';
      doc.text(couponText, 420, summaryLineY);
      doc.fillColor('green');
      doc.text(`-₹${discount.toFixed(2)}`, 490, summaryLineY);
      summaryLineY += 15;
    }
    
    // Show total refund
    if (data.totalRefund && data.totalRefund > 0) {
      doc.fillColor('red');
      doc.text('Total Refund:', 420, summaryLineY);
      doc.text(`-₹${data.totalRefund.toFixed(2)}`, 490, summaryLineY);
      summaryLineY += 15;
    }
    
    // Add separator line
    doc.strokeColor('#E0E0E0').lineWidth(1)
       .moveTo(420, summaryLineY + 5).lineTo(550, summaryLineY + 5).stroke();
    summaryLineY += 15;
    
    // Final amount
    doc.fillColor('black').font('Helvetica-Bold');
    doc.text('Final Amount:', 420, summaryLineY);
    doc.text(`₹${data.finalAmount.toFixed(2)}`, 490, summaryLineY);

    // Order Information Section
    const orderInfoY = summaryLineY + 40;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('black')
       .text('Order Information:', 50, orderInfoY);
    
    doc.font('Helvetica').fontSize(9);
    doc.text('• Your order is currently being processed/shipped', 50, orderInfoY + 20);
    doc.text('• Final refund calculations will be updated upon delivery/completion', 50, orderInfoY + 35);
    doc.text('• This invoice reflects your payment confirmation and current order status', 50, orderInfoY + 50);

    // Smart Refund Information Section
    doc.fillColor('red').font('Helvetica-Bold').fontSize(10)
       .text('Smart Refund Information:', 50, orderInfoY + 80);
    
    doc.fillColor('black').font('Helvetica').fontSize(9);
    doc.text('• Refund amounts are calculated based on remaining valid items and coupon eligibility', 50, orderInfoY + 100);
    doc.text('• If coupon minimum is not met after cancellation/return, discount will be removed', 50, orderInfoY + 115);
    doc.text('• Refunds will be processed to your wallet/original payment method within 5-7 business days', 50, orderInfoY + 130);
    
    // Show coupon status if applicable
    if (couponApplied) {
      doc.fillColor('blue');
      const couponMessage = couponCode ? 
        `• Coupon "${couponCode}" was applied to this order - refund amounts reflect coupon validity rules` :
        '• Coupon was applied to this order - refund amounts reflect coupon validity rules';
      doc.text(couponMessage, 50, orderInfoY + 145);
    }

    // Footer
    const footerY = orderInfoY + (couponApplied ? 180 : 160);
    doc.fillColor('gray').fontSize(8)
       .text('Payment processed securely through Razorpay Gateway', 50, footerY, { align: 'center' });
    doc.text('Powered by karma', 50, footerY + 15, { align: 'center' });
    doc.text('Thank you for shopping with us!', 50, footerY + 30, { align: 'center' });
    doc.text('For any queries, contact us at support@karma.com', 50, footerY + 45, { align: 'center' });

    doc.end();

    stream.on('finish', () => resolve());
    stream.on('error', err => reject(err));
  });
}

module.exports = generateInvoice;