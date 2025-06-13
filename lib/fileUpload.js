const path = require('path');
const fs = require('fs');

async function uploadFile(file) {
  // Example: move the file to a static folder
  const uploadsDir = path.join(__dirname, '..', 'uploads');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }

  const destPath = path.join(uploadsDir, file.originalname);

  fs.renameSync(file.path, destPath);

  return {
    url: `/uploads/${file.originalname}` // Assumes a static route will serve this
  };
}

module.exports = {
  uploadFile
};
