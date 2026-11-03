<?php
// ============================================================
// SPHINXTOUR - HOSTINGER DATABASE CONFIGURATION
// ============================================================

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, x-admin-pin");
header("Content-Type: application/json; charset=UTF-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Hostinger MySQL Credentials
// (Update these with the database credentials created in Hostinger hPanel -> Databases)
define('DB_HOST', 'localhost');
define('DB_NAME', 'u123456789_sphinxtour');
define('DB_USER', 'u123456789_user');
define('DB_PASS', 'YourPasswordHere');

function getDbConnection() {
    try {
        $pdo = new PDO(
            "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]
        );
        return $pdo;
    } catch (PDOException $e) {
        return null; // Fallback to JSON file if MySQL is not configured yet
    }
}

// Fallback JSON database path
define('JSON_DB_PATH', __DIR__ . '/../data/database.json');

function getJsonData() {
    if (file_exists(JSON_DB_PATH)) {
        $content = file_get_contents(JSON_DB_PATH);
        return json_decode($content, true);
    }
    return ['settings' => [], 'cities' => [], 'tours' => [], 'bookings' => []];
}

function saveJsonData($data) {
    return file_put_contents(JSON_DB_PATH, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}
