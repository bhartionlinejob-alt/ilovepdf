// Add this at the top of server.js (after imports)
const CloudConvert = require('cloudconvert');

// Update your convertWithCloudConvert function to this:
async function convertWithCloudConvert(fileBuffer, inputFormat, outputFormat) {
    if (!cloudConvert) {
        throw new Error('CloudConvert API key not configured');
    }
    
    try {
        console.log(`🔄 CloudConvert: ${inputFormat} → ${outputFormat}`);
        
        // Create job (syntax changed in v3)
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
        const uploadUrl = uploadTask.result.form.url;
        
        // Upload using fetch
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: fileBuffer,
            headers: {
                'Content-Type': 'application/octet-stream'
            }
        });
        
        if (!uploadResponse.ok) {
            throw new Error('Upload failed');
        }

        // Wait for completion
        let finishedJob = await cloudConvert.jobs.wait(job.id);
        
        // Check for errors
        if (finishedJob.status === 'error') {
            throw new Error(finishedJob.message || 'Conversion failed');
        }

        // Get download URL
        const exportTask = finishedJob.tasks.find(task => task.name === 'export-file');
        const downloadUrl = exportTask.result.files[0].url;
        
        // Download converted file
        const downloadResponse = await fetch(downloadUrl);
        const outputBuffer = Buffer.from(await downloadResponse.arrayBuffer());
        
        console.log(`✅ Conversion successful: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
        return outputBuffer;
        
    } catch (error) {
        console.error('❌ CloudConvert error:', error);
        throw new Error(`Conversion failed: ${error.message}`);
    }
}
