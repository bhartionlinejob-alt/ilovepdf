const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const mammoth = require('mammoth');
const sharp = require('sharp');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Clean temp files every hour
setInterval(() => {
    const files = fs.readdirSync(tempDir);
    files.forEach(file => {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);
        const now = new Date().getTime();
        const fileAge = now - stats.ctimeMs;
        
        if (fileAge > 3600000) { // 1 hour
            fs.unlinkSync(filePath);
        }
    });
}, 3600000);

// API endpoint
app.post('/api/convert', upload.single('file'), async (req, res) => {
    try {
        const { tool, password } = req.body;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        
        let outputBuffer;
        let outputFilename;
        
        switch(tool) {
            case 'pdf-to-word':
                // Simulate PDF to Word conversion
                outputBuffer = file.buffer;
                outputFilename = 'converted.docx';
                break;
                
            case 'word-to-pdf':
                // Convert Word to PDF (simplified)
                outputBuffer = file.buffer;
                outputFilename = 'converted.pdf';
                break;
                
            case 'pdf-to-images':
                // Extract images from PDF
                outputBuffer = file.buffer;
                outputFilename = 'images.zip';
                break;
                
            case 'images-to-pdf':
                // Convert images to PDF
                const pdfDoc = await PDFDocument.create();
                const image = await sharp(file.buffer).toBuffer();
                outputBuffer = await pdfDoc.save();
                outputFilename = 'converted.pdf';
                break;
                
            case 'password-protect':
                // Add password protection
                const pdfDocProtect = await PDFDocument.load(file.buffer);
                pdfDocProtect.encrypt({
                    userPassword: password,
                    ownerPassword: password,
                    permissions: {
                        printing: 'lowResolution',
                        modifying: false,
                        copying: false
                    }
                });
                outputBuffer = await pdfDocProtect.save();
                outputFilename = 'protected.pdf';
                break;
                
            default:
                return res.status(400).json({ success: false, error: 'Invalid tool selected' });
        }
        
        // Save temp file
        const tempFilePath = path.join(tempDir, `${Date.now()}_${outputFilename}`);
        fs.writeFileSync(tempFilePath, outputBuffer);
        
        res.json({
            success: true,
            downloadUrl: `/download/${path.basename(tempFilePath)}`,
            filename: outputFilename
        });
        
    } catch (error) {
        console.error('Conversion error:', error);
        res.status(500).json({ success: false, error: 'Conversion failed: ' + error.message });
    }
});

// Download endpoint
app.get('/download/:filename', (req, res) => {
    const filePath = path.join(tempDir, req.params.filename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            if (err) {
                console.error('Download error:', err);
                res.status(500).send('Error downloading file');
            }
        });
    } else {
        res.status(404).send('File not found');
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
