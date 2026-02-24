# flyower-elysia
基于elysia.bunjs 的 全栈开发测试
```
cd app
bun install
bun run dev src/index.ts
```
将自己设为管理员（只需一次）
sqlite3 users.db "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';"
sqlite3 users.db "ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;"
sqlite3 users.db "UPDATE users SET role='admin' WHERE username='123123';"
sqlite3 users.db "SELECT id, username, role, is_banned FROM users;"
将123123换成你的用户名称
// 修改 index.ts pp.post('/images', ...) 处理函数中，插入数据库的那一行
info的参数pending（审查） 或approved （不审查）