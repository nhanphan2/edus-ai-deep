// api/get-user-messages.js
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const fs = require('fs').promises;
        const path = require('path');
        const filePath = path.join('/tmp', 'user-messages.json');
        
        const fileContent = await fs.readFile(filePath, 'utf8');
        const messages = JSON.parse(fileContent);
        
        res.status(200).json({ 
            success: true, 
            messages: messages,
            count: messages.length 
        });
    } catch (error) {
        res.status(200).json({ 
            success: true, 
            messages: [],
            count: 0 
        });
    }
}