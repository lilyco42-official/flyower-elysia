import { Elysia, t } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { jwt } from '@elysiajs/jwt';          // 引入 JWT 插件
import { Database } from 'bun:sqlite';

// 初始化数据库
const db = new Database('users.db');
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 辅助函数：检查用户名是否存在
const userExists = (username: string): boolean => {
  const stmt = db.query('SELECT id FROM users WHERE username = ?');
  return stmt.get(username) !== null;
};

// 根据用户名查找用户（返回完整记录，用于登录验证）
const findUserByUsername = (username: string) => {
  const stmt = db.query('SELECT id, username, password_hash FROM users WHERE username = ?');
  return stmt.get(username) as { id: number; username: string; password_hash: string } | null;
};

// 创建用户
const createUser = (username: string, passwordHash: string) => {
  const stmt = db.query('INSERT INTO users (username, password_hash) VALUES (?, ?)');
  stmt.run(username, passwordHash);
};

const app = new Elysia()
  // 静态文件服务
  .use(staticPlugin({
    assets: 'public',
    prefix: '/'
  }))
  // JWT 插件配置
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET || 'dev-secret-key' // 生产环境务必使用强密码并放在环境变量
    })
  )
  // 根路径重定向到注册页
  .get('/', ({ redirect }) => redirect('/sign_up.html'))

  // ---------- 注册 API ----------
  .post('/sign_up', async ({ body }) => {
    const { username, password, confirm_password } = body;

    if (!username || !password || !confirm_password) {
      return { success: false, message: '所有字段都必须填写' };
    }
    if (password !== confirm_password) {
      return { success: false, message: '两次密码不一致' };
    }
    if (password.length < 6) {
      return { success: false, message: '密码至少6位' };
    }
    if (userExists(username)) {
      return { success: false, message: '用户名已存在，<a href="/sign_in.html">点击登录</a>' };
    }

    const passwordHash = await Bun.password.hash(password);
    createUser(username, passwordHash);
    return { success: true, message: '注册成功' };
  }, {
    body: t.Object({
      username: t.String({ minLength: 1 }),
      password: t.String({ minLength: 6 }),
      confirm_password: t.String()
    })
  })

  // ---------- 登录 API ----------
  .post('/sign_in', async ({ body, jwt, set }) => {
    const { username, password } = body;

    // 查找用户
    const user = findUserByUsername(username);
    if (!user) {
      set.status = 401;
      return { success: false, message: '用户名或密码错误' };
    }

    // 验证密码
    const isValid = await Bun.password.verify(password, user.password_hash);
    if (!isValid) {
      set.status = 401;
      return { success: false, message: '用户名或密码错误' };
    }

    // 生成 JWT token（有效期为7天，可自行调整）
    const token = await jwt.sign({
      userId: user.id,
      username: user.username,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7天过期
    });

    return {
      success: true,
      message: '登录成功',
      token
    };
  }, {
    body: t.Object({
      username: t.String(),
      password: t.String()
    })
  })

  // ---------- 获取当前用户信息（需携带 token）----------
  .get('/me', async ({ jwt, headers, set }) => {
    const auth = headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      set.status = 401;
      return { message: '未提供认证 token' };
    }

    const token = auth.slice(7); // 去掉 "Bearer " 前缀
    const payload = await jwt.verify(token);
    if (!payload) {
      set.status = 401;
      return { message: 'token 无效或已过期' };
    }

    return {
      userId: payload.userId,
      username: payload.username
    };
  })

  .listen(3000);

console.log(`🦊 Elysia is running at http://localhost:3000`);