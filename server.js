const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const CloudConvert = require('cloudconvert');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ CONFIGURATION ============
const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY;
const IS_CLOUDCONVERT_AVAILABLE = !!CLOUDCONVERT_API_KEY;

// Initialize CloudConvert if API key is provided
let cloudConvert = null;
if (IS_CLOUDCONVERT_AVAILABLE) {
    cloudConvert = new CloudConvert({ apiKey: CLOUDCONVERT_API_KEY });
    console.log('✅ CloudConvert API initialized');
} else {
    console.warn('⚠️ CLOUDCONVERT_API_KEY not set. Word conversion will not work.');
    console.warn('Add it in Render Dashboard → Environment Variables');
}

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
        if (Date.now() - stats.ctimeMs > 3600000) {
            fs.unlinkSync(filePath);
            console.log(`🗑️ Deleted old file: ${file}`);
        }
    });
}, 3600000);

// ============ CLOUDCONVERT CONVERSION FUNCTION ============

async function convertWithCloudConvert(fileBuffer, inputFormat, outputFormat) {
    if (!cloudConvert) {
        throw new Error('CloudConvert API key not configured. Please add CLOUDCONVERT_API_KEY environment variable.');
    }
    
    try {
        console.log(`🔄 CloudConvert: ${inputFormat} → ${outputFormat}`);
        
        // Create job
        const job = await cloudConvert.jobs.create({
            tasks: {
                'import-file': {
                    operation: 'import/upload'
                },
                'convert-file': {
                    operation: 'convert',
                    input: 'import-file',
                    input_format: inputFormat,
                    output_format: outputFormat,
                    engine: 'default'
                },
                'export-file': {
                    operation: 'export/url',
                    input: 'convert-file'
                }
            }
        });

        // Upload file
        const uploadTask = job.tasks.find(task => task.name === 'import-file');
        await cloudConvert.upload(uploadTask.result.form.url, fileBuffer, {
            'Content-Type': 'application/octet-stream'
        });

        // Wait for completion
        const finishedJob = await cloudConvert.jobs.wait(job.id);
        
        if (finishedJob.status === 'error') {
            throw new Error(finishedJob.message);
        }

        // Download result
        const exportTask = finishedJob.tasks.find(task => task.name === 'export-file');
        const downloadUrl = exportTask.result.files[0].url;
        const response = await fetch(downloadUrl);
        const outputBuffer = Buffer.from(await response.arrayBuffer());
        
        console.log(`✅ Conversion successful: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
        return outputBuffer;
        
    } catch (error) {
        console.error('❌ CloudConvert error:', error);
        throw new Error(`Conversion failed: ${error.message}`);
    }
}

// ============ PDF-ONLY OPERATIONS (FREE, NO API NEEDED) ============

async function protectPdf(pdfBuffer, password) {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    pdfDoc.encrypt({
        userPassword: password,
        ownerPassword: password,
        permissions: {
            printing: 'highResolution',
            modifying: false,
            copying: false,
            annotating: false,
            fillingForms: false,
            contentAccessibility: true,
            documentAssembly: false
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

async function extractPages(pdfBuffer, pageNumbers) {
    const sourcePdf = await PDFDocument.load(pdfBuffer);
    const newPdf = await PDFDocument.create();
    const pages = await newPdf.copyPages(sourcePdf, pageNumbers);
    pages.forEach(page => newPdf.addPage(page));
    return await newPdf.save();
}

async function rotatePdf(pdfBuffer, rotationDegrees) {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    pages.forEach(page => {
        page.setRotation(rotationDegrees);
    });
    return await pdfDoc.save();
}

async function compressPdf(pdfBuffer) {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    return await pdfDoc.save();
}

// ============ API ENDPOINT ============

app.post('/api/convert', upload.array('files', 5), async (req, res) => {
    try {
        const { tool, password, pageNumbers, rotation } = req.body;
        const files = req.files;
        
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files uploaded' });
        }
        
        console.log(`📁 Processing: ${tool} - ${files[0].originalname} (${(files[0].size / 1024).toFixed(2)} KB)`);
        
        let outputBuffer;
        let outputFilename;
        
        switch(tool) {
            // ============ CLOUDCONVERT OPERATIONS (Require API Key) ============
            case 'word-to-pdf':
                if (!IS_CLOUDCONVERT_AVAILABLE) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Word to PDF conversion requires CloudConvert API key. Please add CLOUDCONVERT_API_KEY environment variable.' 
                    });
                }
                outputBuffer = await convertWithCloudConvert(files[0].buffer, 'docx', 'pdf');
                outputFilename = 'converted.pdf';
                break;
                
            case 'pdf-to-word':
                if (!IS_CLOUDCONVERT_AVAILABLE) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'PDF to Word conversion requires CloudConvert API key. Please add CLOUDCONVERT_API_KEY environment variable.' 
                    });
                }
                outputBuffer = await convertWithCloudConvert(files[0].buffer, 'pdf', 'docx');
                outputFilename = 'converted.docx';
                break;
                
            case 'pdf-to-images':
                if (!IS_CLOUDCONVERT_AVAILABLE) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'PDF to Images conversion requires CloudConvert API key. Please add CLOUDCONVERT_API_KEY environment variable.' 
                    });
                }
                outputBuffer = await convertWithCloudConvert(files[0].buffer, 'pdf', 'png');
                outputFilename = 'converted_images.zip';
                break;
            
            // ============ FREE PDF OPERATIONS (No API Key Needed) ============
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
                
            case 'extract-pages':
                const pages = pageNumbers ? JSON.parse(pageNumbers) : [0];
                outputBuffer = await extractPages(files[0].buffer, pages);
                outputFilename = 'extracted.pdf';
                break;
                
            case 'rotate-pdf':
                const rot = rotation ? parseInt(rotation) : 90;
                outputBuffer = await rotatePdf(files[0].buffer, rot);
                outputFilename = 'rotated.pdf';
                break;
                
            case 'compress-pdf':
                outputBuffer = await compressPdf(files[0].buffer);
                outputFilename = 'compressed.pdf';
                break;
                
            default:
                return res.status(400).json({ success: false, error: 'Invalid tool selected' });
        }
        
        // Save output file
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
        cloudconvert: IS_CLOUDCONVERT_AVAILABLE ? 'configured' : 'missing'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📍 Visit: http://localhost:${PORT}`);
    console.log(`🔑 CloudConvert API: ${IS_CLOUDCONVERT_AVAILABLE ? '✅ Configured' : '❌ Not configured'}`);
    
    if (!IS_CLOUDCONVERT_AVAILABLE) {
        console.log('\n⚠️  Word to PDF and PDF to Word will NOT work!');
        console.log('To enable them, add CLOUDCONVERT_API_KEY in Render Environment Variables.\n');
    } else {
        console.log('\n✅ All conversions are ready to use!\n');
    }
});
