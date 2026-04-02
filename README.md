# PDF-4U Online - Professional PDF Tools

## Features
- ✅ **Word to PDF** (via CloudConvert)
- ✅ **PDF to Word** (via CloudConvert)
- ✅ **PDF to Images** (via CloudConvert)
- ✅ **Images to PDF** (Free - No API needed)
- ✅ **Password Protect PDF** (Free - No API needed)
- ✅ **Merge PDFs** (Free - No API needed)

## Setup Instructions

### 1. Get CloudConvert API Key (Required for Word/PDF conversions)
1. Go to https://cloudconvert.com/dashboard/api/v2/keys
2. Sign up for free account
3. Create new API key
4. Free tier: 25 conversion minutes/day

### 2. Deploy on Render
1. Push this code to GitHub
2. Go to Render.com
3. Create new Web Service
4. Connect your GitHub repo
5. Add Environment Variable:
   - Key: `CLOUDCONVERT_API_KEY`
   - Value: `your-api-key`
6. Click Deploy

### 3. Local Development
```bash
npm install
export CLOUDCONVERT_API_KEY=your_key_here
npm start
# Visit http://localhost:3000
