const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const CloudConvert = require('cloudconvert');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ CONFIGURATION ============
const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY;
const IS_CLOUDCONVERT_AVAILABLE = !!CLOUDCONVERT_API_KEY;

// Initialize CloudConvert - CORRECT way per SDK docs[citation:2][citation:10]
let cloudConvert = null;
if (IS_CLOUDCONVERT_AVAILABLE) {
    cloudConvert = new CloudConvert(CLOUDCONVERT_API_KEY);
    console.log('✅ CloudConvert API initialized');
} else {
    console.warn('⚠️ CLOUDCONVERT_API_KEY not set. Word conversion will not work.');
}

// Configure multer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.static(__dirname));
app.use(express.json());

// Temp directory
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

// ============ CLOUDCONVERT FUNCTION (Following SDK Documentation[citation:2][citation:6]) ============

async function convertWithCloudConvert(fileBuffer, inputFormat, outputFormat) {
    if (!cloudConvert) {
        throw new Error('CloudConvert API key not configured');
    }
    
    try {
        console.log(`🔄 CloudConvert: ${inputFormat} → ${outputFormat}`);
        
        // Create job - following official SDK structure[citation:2]
        const job = await cloudConvert.jobs.create({
            tasks: {
                'upload-file': {
                    operation: 'import/upload'
                },
                'convert-file': {
                    operation: 'convert',
                    input: 'upload-file',  // References the upload task
                    input_format: inputFormat,
                    output_format: outputFormat,
                    engine: 'default'
                },
                'export-file': {
                    operation: 'export/url',
                    input: 'convert-file'  // References the convert task
                }
            }
        });

        // Get the upload task
        const uploadTask = job.tasks.find(task => task.name === 'upload-file');
        
        if (!uploadTask) {
            throw new Error('Upload task not found');
        }

        // Upload using SDK's built-in method[citation:2]
        const { Readable } = require('stream');
        const bufferStream = new Readable();
        bufferStream.push(fileBuffer);
        bufferStream.push(null);
        
        await cloudConvert.tasks.upload(uploadTask, bufferStream, 'input_file');
        
        console.log('📤 File uploaded, waiting for conversion...');

        // Wait for job completion[citation:2]
        let finishedJob = await cloudConvert.jobs.wait(job.id);
        
        if (finishedJob.status === 'error') {
            throw new Error(finishedJob.message || 'Conversion failed');
        }

        // Find export task and get download URL[citation:2][citation:6]
        const exportTask = finishedJob.tasks.find(task => task.name === 'export-file');
        
        if (!exportTask || !exportTask.result || !exportTask.result.files || exportTask.result.files.length === 0) {
            throw new Error('No output file generated');
        }
        
        const file = exportTask.result.files[0];
        const downloadUrl = file.url;
        
        console.log(`📥 Downloading from: ${downloadUrl}`);
        
        // Download the converted file[citation:2]
        const outputBuffer = await new Promise((resolve, reject) => {
            https.get(downloadUrl, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Download failed with status ${response.statusCode}`));
                    return;
                }
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
            }).on('error', reject);
        });
        
        console.log(`✅ Conversion successful: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
        return outputBuffer;
        
    } catch (error) {
        console.error('❌ CloudConvert error:', error);
        throw new Error(`Conversion failed: ${error.message}`);
    }
}

// ============ FREE PDF OPERATIONS ============

async function protectPdf(pdfBuffer, password) {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
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
    return await pdfDoc.save();
}

async function imageToPdf(imageBuffer, imageType) {
    const pdfDoc = await PDFDocument.create();
    let image;
    
    if (imageType === 'jpg' || imageType === 'jpeg') {
        image = await pdfDoc.embedJpg(imageBuffer);
    } else if (imageType === 'png') {
        image = await pdfDoc.embedPng(imageBuffer);
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
    
    return await pdfDoc.save();
}

async function mergePdfs(pdfBuffers) {
    const mergedPdf = await PDFDocument.create();
    for (const buffer of pdfBuffers) {
        const pdf = await PDFDocument.load(buffer);
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
    }
    return await mergedPdf.save();
}

// ============ API ENDPOINT ============

app.post('/api/convert', upload.array('files', 5), async (req, res) => {
    try {
        const { tool, password } = req.body;
        const files = req.files;
        
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files uploaded' });
        }
        
        console.log(`📁 Processing: ${tool} - ${files[0].originalname}`);
        
        let outputBuffer;
        let outputFilename;
        
        switch(tool) {
            case 'word-to-pdf':
                if (!IS_CLOUDCONVERT_AVAILABLE) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'CloudConvert API key not configured. Add CLOUDCONVERT_API_KEY in Render environment variables.' 
                    });
                }
                outputBuffer = await convertWithCloudConvert(files[0].buffer, 'docx', 'pdf');
                outputFilename = 'converted.pdf';
                break;
                
            case 'pdf-to-word':
                if (!IS_CLOUDCONVERT_AVAILABLE) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'CloudConvert API key not configured.' 
                    });
                }
                outputBuffer = await convertWithCloudConvert(files[0].buffer, 'pdf', 'docx');
                outputFilename = 'converted.docx';
                break;
                
            case 'pdf-to-images':
                if (!IS_CLOUDCONVERT_AVAILABLE) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'CloudConvert API key not configured.' 
                    });
                }
                outputBuffer = await convertWithCloudConvert(files[0].buffer, 'pdf', 'png');
                outputFilename = 'converted_images.zip';
                break;
            
            case 'images-to-pdf':
                const ext = files[0].originalname.split('.').pop().toLowerCase();
                outputBuffer = await imageToPdf(files[0].buffer, ext);
                outputFilename = 'converted.pdf';
                break;
                
            case 'password-protect':
                if (!password) {
                    return res.status(400).json({ success: false, error: 'Password required' });
                }
                outputBuffer = await protectPdf(files[0].buffer, password);
                outputFilename = 'protected.pdf';
                break;
                
            case 'merge-pdfs':
                const buffers = files.map(f => f.buffer);
                outputBuffer = await mergePdfs(buffers);
                outputFilename = 'merged.pdf';
                break;
                
            default:
                return res.status(400).json({ success: false, error: 'Invalid tool selected' });
        }
        
        // Save output
        const tempFilePath = path.join(tempDir, `${Date.now()}_${outputFilename}`);
        fs.writeFileSync(tempFilePath, outputBuffer);
        
        res.json({
            success: true,
            downloadUrl: `/download/${path.basename(tempFilePath)}`,
            filename: outputFilename,
            message: 'File converted successfully!'
        });
        
    } catch (error) {
        console.error('❌ Conversion error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Conversion failed' 
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
        cloudconvert: IS_CLOUDCONVERT_AVAILABLE ? 'configured' : 'missing'
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`🔑 CloudConvert API: ${IS_CLOUDCONVERT_AVAILABLE ? '✅ Configured' : '❌ Not configured'}`);
});
