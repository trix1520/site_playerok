const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Инициализация базы данных
const db = new sqlite3.Database('./giftmarket.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err);
    } else {
        console.log('Подключено к базе данных SQLite');
        initDatabase();
    }
});

// Создание таблиц
function initDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            telegram_id TEXT UNIQUE,
            ton_wallet TEXT,
            card_number TEXT,
            card_bank TEXT,
            card_currency TEXT,
            telegram_username TEXT,
            completed_deals INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            seller_id INTEGER NOT NULL,
            buyer_id INTEGER,
            type TEXT NOT NULL,
            payment_method TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            seller_requisites TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (seller_id) REFERENCES users(id),
            FOREIGN KEY (buyer_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS volumes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            currency TEXT NOT NULL,
            amount REAL NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS order_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(order_id, user_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            order_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `);

    console.log('База данных инициализирована');
}

// Генерация уникального буквенно-цифрового кода ордера (8 символов)
function generateOrderCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Создание уведомления
function createNotification(userId, orderId, type, message) {
    db.run(
        'INSERT INTO notifications (user_id, order_id, type, message) VALUES (?, ?, ?, ?)',
        [userId, orderId, type, message],
        (err) => {
            if (err) {
                console.error('Ошибка создания уведомления:', err);
            }
        }
    );
}

// API Routes

// Создание/получение пользователя
app.post('/api/users', (req, res) => {
    const { username, telegram_id } = req.body;

    if (!username || !telegram_id) {
        return res.status(400).json({ error: 'Username и telegram_id обязательны' });
    }

    db.get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (user) {
            return res.json(user);
        }

        db.run(
            'INSERT INTO users (username, telegram_id) VALUES (?, ?)',
            [username, telegram_id],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                db.get('SELECT * FROM users WHERE id = ?', [this.lastID], (err, user) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    res.json(user);
                });
            }
        );
    });
});

// Получение данных пользователя
app.get('/api/users/:telegram_id', (req, res) => {
    const { telegram_id } = req.params;

    db.get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        db.all('SELECT currency, SUM(amount) as total FROM volumes WHERE user_id = ? GROUP BY currency', 
            [user.id], 
            (err, volumes) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                const volumesObj = {};
                volumes.forEach(v => {
                    volumesObj[v.currency] = v.total;
                });

                res.json({
                    ...user,
                    volumes: volumesObj
                });
            }
        );
    });
});

// Обновление реквизитов пользователя
app.put('/api/users/:telegram_id/requisites', (req, res) => {
    const { telegram_id } = req.params;
    const { ton_wallet, card_number, card_bank, card_currency, telegram_username } = req.body;

    const updates = [];
    const values = [];

    if (ton_wallet !== undefined) {
        updates.push('ton_wallet = ?');
        values.push(ton_wallet);
    }
    if (card_number !== undefined) {
        updates.push('card_number = ?');
        values.push(card_number);
    }
    if (card_bank !== undefined) {
        updates.push('card_bank = ?');
        values.push(card_bank);
    }
    if (card_currency !== undefined) {
        updates.push('card_currency = ?');
        values.push(card_currency);
    }
    if (telegram_username !== undefined) {
        updates.push('telegram_username = ?');
        values.push(telegram_username);
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    values.push(telegram_id);

    db.run(
        `UPDATE users SET ${updates.join(', ')} WHERE telegram_id = ?`,
        values,
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            res.json({ success: true });
        }
    );
});

// Создание ордера с проверкой уникальности кода
app.post('/api/orders', (req, res) => {
    const { seller_telegram_id, type, payment_method, amount, currency, description, seller_requisites } = req.body;

    if (!seller_telegram_id || !type || !payment_method || !amount || !currency || !description || !seller_requisites) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    db.get('SELECT id FROM users WHERE telegram_id = ?', [seller_telegram_id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Функция для попытки создания ордера с уникальным кодом
        const attemptCreateOrder = (attempt = 0) => {
            if (attempt > 10) {
                return res.status(500).json({ error: 'Не удалось создать уникальный код ордера' });
            }

            const code = generateOrderCode();

            db.run(
                `INSERT INTO orders (code, seller_id, type, payment_method, amount, currency, description, seller_requisites) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [code, user.id, type, payment_method, amount, currency, description, seller_requisites],
                function(err) {
                    if (err) {
                        // Если код не уникален, пробуем еще раз
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return attemptCreateOrder(attempt + 1);
                        }
                        return res.status(500).json({ error: err.message });
                    }

                    db.run(
                        'INSERT INTO order_participants (order_id, user_id, role) VALUES (?, ?, ?)',
                        [this.lastID, user.id, 'seller'],
                        (err) => {
                            if (err) {
                                console.error('Ошибка добавления участника:', err);
                            }
                        }
                    );

                    db.get('SELECT * FROM orders WHERE id = ?', [this.lastID], (err, order) => {
                        if (err) {
                            return res.status(500).json({ error: err.message });
                        }
                        res.json(order);
                    });
                }
            );
        };

        attemptCreateOrder();
    });
});

// Получение ордера по ID или коду
app.get('/api/orders/:identifier', (req, res) => {
    const { identifier } = req.params;
    const query = 'SELECT * FROM orders WHERE code = ? OR id = ?';

    db.get(query, [identifier, identifier], (err, order) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!order) {
            return res.status(404).json({ error: 'Ордер не найден' });
        }

        res.json(order);
    });
});

// Получение ордеров пользователя
app.get('/api/users/:telegram_id/orders', (req, res) => {
    const { telegram_id } = req.params;

    db.get('SELECT id FROM users WHERE telegram_id = ?', [telegram_id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        db.all(
            `SELECT DISTINCT o.* FROM orders o
             INNER JOIN order_participants op ON o.id = op.order_id
             WHERE op.user_id = ?
             ORDER BY o.created_at DESC`,
            [user.id],
            (err, orders) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                res.json(orders);
            }
        );
    });
});

// Подключение к ордеру (покупатель)
app.post('/api/orders/:id/join', (req, res) => {
    const { id } = req.params;
    const { buyer_telegram_id } = req.body;

    if (!buyer_telegram_id) {
        return res.status(400).json({ error: 'buyer_telegram_id обязателен' });
    }

    db.get('SELECT id FROM users WHERE telegram_id = ?', [buyer_telegram_id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        db.get('SELECT * FROM orders WHERE id = ? AND status = ?', [id, 'active'], (err, order) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!order) {
                return res.status(404).json({ error: 'Активный ордер не найден' });
            }

            if (order.seller_id === user.id) {
                return res.status(400).json({ error: 'Вы не можете купить свой собственный ордер' });
            }

            db.run(
                'INSERT OR IGNORE INTO order_participants (order_id, user_id, role) VALUES (?, ?, ?)',
                [id, user.id, 'buyer'],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }

                    db.run(
                        'UPDATE orders SET buyer_id = ? WHERE id = ? AND buyer_id IS NULL',
                        [user.id, id],
                        (err) => {
                            if (err) {
                                console.error('Ошибка обновления buyer_id:', err);
                            } else {
                                // Создаем уведомление продавцу
                                createNotification(
                                    order.seller_id,
                                    id,
                                    'buyer_joined',
                                    `Покупатель присоединился к ордеру #${order.code}`
                                );
                            }
                        }
                    );

                    res.json({ success: true, message: 'Вы успешно подключились к ордеру' });
                }
            );
        });
    });
});

// Обновление статуса ордера
app.put('/api/orders/:id/status', (req, res) => {
    const { id } = req.params;
    const { status, user_telegram_id } = req.body;

    if (!status || !user_telegram_id) {
        return res.status(400).json({ error: 'status и user_telegram_id обязательны' });
    }

    const validStatuses = ['active', 'paid', 'transferred', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Неверный статус' });
    }

    db.get('SELECT id FROM users WHERE telegram_id = ?', [user_telegram_id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!order) {
                return res.status(404).json({ error: 'Ордер не найден' });
            }

            db.run(
                'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [status, id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }

                    // Обработка уведомлений в зависимости от статуса
                    if (status === 'paid') {
                        // Уведомление продавцу об оплате
                        createNotification(
                            order.seller_id,
                            id,
                            'payment_confirmed',
                            `Покупатель подтвердил оплату ордера #${order.code}`
                        );
                    } else if (status === 'transferred') {
                        // Уведомление покупателю о передаче актива
                        if (order.buyer_id) {
                            createNotification(
                                order.buyer_id,
                                id,
                                'asset_transferred',
                                `Продавец передал актив по ордеру #${order.code}. Проверьте получение.`
                            );
                        }
                    } else if (status === 'completed') {
                        // Обновляем статистику для продавца
                        db.run(
                            'UPDATE users SET completed_deals = completed_deals + 1 WHERE id = ?',
                            [order.seller_id],
                            (err) => {
                                if (err) console.error('Ошибка обновления статистики продавца:', err);
                            }
                        );

                        // Обновляем статистику для покупателя
                        if (order.buyer_id) {
                            db.run(
                                'UPDATE users SET completed_deals = completed_deals + 1 WHERE id = ?',
                                [order.buyer_id],
                                (err) => {
                                    if (err) console.error('Ошибка обновления статистики покупателя:', err);
                                }
                            );
                        }

                        // Обновляем объем торговли для продавца
                        db.run(
                            'INSERT INTO volumes (user_id, currency, amount) VALUES (?, ?, ?)',
                            [order.seller_id, order.currency, order.amount],
                            (err) => {
                                if (err) console.error('Ошибка обновления объема продавца:', err);
                            }
                        );

                        // Обновляем объем торговли для покупателя
                        if (order.buyer_id) {
                            db.run(
                                'INSERT INTO volumes (user_id, currency, amount) VALUES (?, ?, ?)',
                                [order.buyer_id, order.currency, order.amount],
                                (err) => {
                                    if (err) console.error('Ошибка обновления объема покупателя:', err);
                                }
                            );
                        }

                        // Уведомление обеим сторонам о завершении
                        createNotification(
                            order.seller_id,
                            id,
                            'order_completed',
                            `Ордер #${order.code} успешно завершен`
                        );

                        if (order.buyer_id) {
                            createNotification(
                                order.buyer_id,
                                id,
                                'order_completed',
                                `Ордер #${order.code} успешно завершен`
                            );
                        }
                    }

                    res.json({ success: true, order: { ...order, status } });
                }
            );
        });
    });
});

// Получение уведомлений пользователя
app.get('/api/users/:telegram_id/notifications', (req, res) => {
    const { telegram_id } = req.params;

    db.get('SELECT id FROM users WHERE telegram_id = ?', [telegram_id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        db.all(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [user.id],
            (err, notifications) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                res.json(notifications);
            }
        );
    });
});

// Отметить уведомление как прочитанное
app.put('/api/notifications/:id/read', (req, res) => {
    const { id } = req.params;

    db.run(
        'UPDATE notifications SET read = 1 WHERE id = ?',
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            res.json({ success: true });
        }
    );
});

// Получение активных ордеров (публичный список)
app.get('/api/orders', (req, res) => {
    const { status = 'active', limit = 50 } = req.query;

    db.all(
        'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?',
        [status, parseInt(limit)],
        (err, orders) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            res.json(orders);
        }
    );
});

// Статистика платформы
app.get('/api/stats', (req, res) => {
    const stats = {};

    db.get("SELECT COUNT(*) as total FROM orders WHERE status = 'completed'", (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        stats.completedDeals = result.total;

        db.get('SELECT COUNT(*) as total FROM users', (err, result) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            stats.totalUsers = result.total;

            db.get("SELECT COUNT(*) as total FROM orders WHERE status = 'active'", (err, result) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                stats.activeOrders = result.total;

                res.json(stats);
            });
        });
    });
});

// Обработка всех остальных запросов - отдаем index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Ошибка закрытия БД:', err);
        }
        console.log('База данных закрыта');
        process.exit(0);
    });
});