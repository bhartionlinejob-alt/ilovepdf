async uploadLogo(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('logo', file);
    
    try {
        const response = await fetch('/api/admin/upload-logo', {
            method: 'POST',
            headers: { 'Authorization': this.token },
            body: formData
        });
        
        const result = await response.json();
        if (result.success) {
            // Display base64 image
            document.getElementById('logoPreview').innerHTML = `<img src="${result.logoUrl}" alt="Logo">`;
            this.showNotification('Logo uploaded successfully!', 'success');
        } else {
            throw new Error('Upload failed');
        }
    } catch (error) {
        this.showNotification('Failed to upload logo', 'error');
    }
}
