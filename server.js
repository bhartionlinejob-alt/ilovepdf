const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const CloudConvert = require('cloudconvert');
const stream = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ CONFIGURATION ============
// IMPORTANT: Set your API key in Render Environment Variables
const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY;

if (!CLOUDCONVERT_API_KEY) {
    console.error('❌ ERROR: CLOUDCONVERT_API_KEY environment variable not set!');
    console.error('Please add it in Render Dashboard → Environment Variables');
}

// Initialize CloudConvert
const cloudConvert = new CloudConvert({ apiKey: CLOUDCONVERT_API_KEY });

// Configure multer for file upload (memory storage - no disk writes)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

// Ensure temp directory exists (for downloads only)
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
        if (Date.now() - stats.ctimeMs > 3600000) {
            fs.unlinkSync(filePath);
        }
    });
}, 3600000);

// ============ CONVERSION FUNCTION ============

/**
 * Convert file using CloudConvert API
 * @param {Buffer} fileBuffer - The file to convert
 * @param {string} inputFormat - Source format (pdf, docx, jpg, etc.)
 * @param {string} outputFormat - Target format (docx, pdf, png, etc.)
 * @returns {Promise<Buffer>} - Converted file buffer
 */
async function convertWithCloudConvert(fileBuffer, inputFormat, outputFormat) {
    try {
        console.log(`🔄 Starting conversion: ${inputFormat} → ${outputFormat}`);
        
        // Step 1: Create a new job
        const job = await cloudConvert.jobs.create({
            tasks: {
                // Import the file from our server
                'import-file': {
                    operation: 'import/upload'
                },
                // Convert the file
                'convert-file': {
                    operation: 'convert',
                    input: 'import-file',
                    input_format: inputFormat,
                    output_format: outputFormat,
                    engine: 'default' // Uses best available engine
                },
                // Export to URL for download
                'export-file': {
                    operation: 'export/url',
                    input: 'convert-file'
                }
            }
        });

        // Step 2: Get upload URL and upload file
        const uploadTask = job.tasks.find(task => task.name === 'import-file');
        const uploadUrl = uploadTask.result.form.url;
        
        // Upload file buffer directly
        await cloudConvert.upload(uploadUrl, fileBuffer, {
            'Content-Type': 'application/octet-stream'
        });

        // Step 3: Wait for completion
        const finishedJob = await cloudConvert.jobs.wait(job.id);
        
        // Step 4: Check for errors
        if (finishedJob.status === 'error') {
            throw new Error('Conversion failed: ' + finishedJob.message);
        }

        // Step 5: Get download URL
        const exportTask = finishedJob.tasks.find(task => task.name === 'export-file');
        const downloadUrl = exportTask.result.files[0].url;
        
        // Step 6: Download the converted file
        const response = await fetch(downloadUrl);
        const outputBuffer = Buffer.from(await response.arrayBuffer());
        
        console.log(`✅ Conversion successful! Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
        
        return outputBuffer;
        
    } catch (error) {
        console.error('❌ CloudConvert error:', error);
        throw new Error(`Conversion failed: ${error.message}`);
    }
}

// ============ API ENDPOINT ============

app.post('/api/convert', upload.single('file'), async (req, res) => {
    try {
        const { tool, password } = req.body;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        
        if (!CLOUDCONVERT_API_KEY) {
            return res.status(500).json({ success: false, error: 'API key not configured. Please add CLOUDCONVERT_API_KEY environment variable.' });
        }
        
        console.log(`📁 Processing: ${tool} - ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`);
        
        let outputBuffer;
        let outputFilename;
        let inputFormat = '';
        let outputFormat = '';
        
        // Map tools to CloudConvert formats
        switch(tool) {
            case 'pdf-to-word':
                inputFormat = 'pdf';
                outputFormat = 'docx';
                outputFilename = 'converted.docx';
                break;
                
            case 'word-to-pdf':
                inputFormat = 'docx';
                outputFormat = 'pdf';
                outputFilename = 'converted.pdf';
                break;
                
            case 'pdf-to-images':
                inputFormat = 'pdf';
                outputFormat = 'png';
                outputFilename = 'converted_images.zip';
                break;
                
            case 'images-to-pdf':
                // Handle image upload (jpg, png, etc.)
                const ext = path.extname(file.originalname).toLowerCase().substring(1);
                inputFormat = ext === 'jpg' ? 'jpg' : ext === 'jpeg' ? 'jpg' : ext;
                outputFormat = 'pdf';
                outputFilename = 'converted.pdf';
                break;
                
            case 'password-protect':
                // CloudConvert supports PDF encryption
                inputFormat = 'pdf';
                outputFormat = 'pdf';
                outputFilename = 'protected.pdf';
                break;
                
            default:
                return res.status(400).json({ success: false, error: 'Invalid tool selected' });
        }
        
        // For password protect, we need to use pdf-lib (free, no API credits)
        if (tool === 'password-protect') {
            const { PDFDocument } = require('pdf-lib');
            const pdfDoc = await PDFDocument.load(file.buffer);
            pdfDoc.encrypt({
                userPassword: password,
                ownerPassword: password,
                permissions: {
                    printing: 'highResolution',
                    modifying: false,
                    copying: false,
                    annotating: false
                }
            });
            outputBuffer = await pdfDoc.save();
        } 
        // For images-to-pdf, handle specially
        else if (tool === 'images-to-pdf') {
            const { PDFDocument } = require('pdf-lib');
            const pdfDoc = await PDFDocument.create();
            let image;
            
            const ext = path.extname(file.originalname).toLowerCase();
            if (ext === '.jpg' || ext === '.jpeg') {
                image = await pdfDoc.embedJpg(file.buffer);
            } else if (ext === '.png') {
                image = await pdfDoc.embedPng(file.buffer);
            } else {
                throw new Error('Unsupported image format. Use JPG or PNG.');
            }
            
            const page = pdfDoc.addPage([image.width, image.height]);
            page.drawImage(image, {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height
            });
            outputBuffer = await pdfDoc.save();
        }
        else {
            // Use CloudConvert for all other conversions
            outputBuffer = await convertWithCloudConvert(file.buffer, inputFormat, outputFormat);
        }
        
        // Save output file for download
        const tempFilePath = path.join(tempDir, `${Date.now()}_${outputFilename}`);
        fs.writeFileSync(tempFilePath, outputBuffer);
        
        res.json({
            success: true,
            downloadUrl: `/download/${path.basename(tempFilePath)}`,
            filename: outputFilename,
            message: 'File converted successfully!'
        });
        
    } catch (error) {
        console.error('Conversion error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Conversion failed. Please try again.' 
        });
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
        res.status(404).send('File not found or expired');
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        cloudconvertConfigured: !!CLOUDCONVERT_API_KEY
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 Visit: http://localhost:${PORT}`);
    console.log(`🔑 CloudConvert API: ${CLOUDCONVERT_API_KEY ? 'Configured ✓' : 'NOT SET ✗'}`);
});
