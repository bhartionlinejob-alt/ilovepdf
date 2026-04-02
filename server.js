async function convertWithCloudConvert(fileBuffer, inputFormat, outputFormat, originalFilename) {
    if (!cloudConvert) {
        throw new Error('CloudConvert API key not configured');
    }
    
    try {
        console.log(`🔄 CloudConvert: ${inputFormat} → ${outputFormat}`);
        
        // Create job - REMOVED the invalid 'engine' parameter
        const job = await cloudConvert.jobs.create({
            tasks: {
                'upload_file': {
                    operation: 'import/upload'
                },
                'convert_file': {
                    operation: 'convert',
                    input: 'upload_file',
                    input_format: inputFormat,
                    output_format: outputFormat
                    // ❌ REMOVE this line: engine: 'default'
                },
                'export_file': {
                    operation: 'export/url',
                    input: 'convert_file'
                }
            }
        });

        console.log('📋 Job created, ID:', job.id);

        // Find the upload task
        const uploadTask = job.tasks.find(task => task.name === 'upload_file');
        
        if (!uploadTask) {
            throw new Error('Upload task not found');
        }

        // Create readable stream from buffer and upload
        const { Readable } = require('stream');
        const bufferStream = new Readable();
        bufferStream.push(fileBuffer);
        bufferStream.push(null);
        
        // Use the SDK's upload method
        await cloudConvert.tasks.upload(uploadTask, bufferStream, originalFilename);
        
        console.log('📤 File uploaded, waiting for conversion...');

        // Wait for job completion
        let finishedJob = await cloudConvert.jobs.wait(job.id);
        
        if (finishedJob.status === 'error') {
            const errorTask = finishedJob.tasks.find(task => task.status === 'error');
            throw new Error(errorTask?.message || 'Conversion failed');
        }

        console.log('✅ Job completed successfully');

        // Find the export task and get download URL
        const exportTask = finishedJob.tasks.find(task => task.name === 'export_file');
        
        if (!exportTask || !exportTask.result || !exportTask.result.files || exportTask.result.files.length === 0) {
            throw new Error('No output file generated');
        }
        
        const resultFile = exportTask.result.files[0];
        const downloadUrl = resultFile.url;
        
        console.log(`📥 Downloading from: ${downloadUrl}`);
        
        // Download the converted file
        const https = require('https');
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
