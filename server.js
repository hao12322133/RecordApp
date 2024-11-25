const express = require('express');
const cors = require('cors');
const app = express();

// Sử dụng cors với tùy chỉnh các header cho Cross-Origin Isolation
app.use(cors({
    origin: '*',  // Hoặc chỉ định các origin cụ thể
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
}));

// Thêm các header Cross-Origin Isolation vào tất cả các yêu cầu
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');  // Bảo vệ trang khỏi các nguồn ngoài
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');  // Yêu cầu tài nguyên phải có CORP header hợp lệ
    next();
});

// Cung cấp các file tĩnh trong thư mục 'public'
app.use(express.static('public'));

// Ví dụ route khác
app.get('/', (req, res) => {
    res.send('Hello, World!');
});

// Khởi động server
app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
