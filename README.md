# 🌸 Elysia Image Board

一个基于 **Elysia + Bun** 构建的轻量级图片分享社区。  
支持用户上传、点赞、收藏、关注以及管理员审核等功能。

适合：

- 搭建自己的小型图站
- 练习 Bun + Elysia 全栈开发
- 作为学习项目参考

---

## 🏷️ Tech Stack

![Bun](https://img.shields.io/badge/Bun-1.3.9-000?logo=bun)
![Elysia](https://img.shields.io/badge/Elysia-latest-8A2BE2)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite)

- **Runtime:** Bun 1.3+
- **Framework:** Elysia
- **Database:** SQLite (bun:sqlite)
- **Image Processing:** Sharp
- **Auth:** @elysiajs/jwt + Bun.password
- **Static Service:** @elysiajs/static

---

# ✨ Features

## 👤 用户端

- 注册 / 登录（用户名或邮箱）
- JWT 身份验证
- 上传图片（标题 / 描述 / 标签）
- 每日上传限额（默认 50MB）
- 浏览图片
  - 最新
  - 最热
  - 随机
- 点赞 / 取消点赞
- 收藏夹
  - 创建（公开 / 私密）
  - 添加 / 移除图片
- 关注 / 取消关注用户
- 个人主页
  - 上传数
  - 粉丝数
  - 关注数
- 查看关注动态

---

## 🛡️ 管理员端

- 控制台统计
  - 用户数
  - 图片数
  - 待审核数
- 图片管理
  - 审核通过 / 拒绝
  - 批量操作
  - 删除
- 用户管理
  - 封禁 / 解封
  - 修改角色
  - 删除用户
- 待审核图片列表

---

## 🧾 审核流程

1. 用户上传图片 → 状态为 `pending`
2. 管理员审核：
   - `approved` → 公开显示
   - `rejected` → 填写拒绝原因

---

# 🚀 Quick Start

## 📦 前置要求

安装 Bun：

```bash
curl -fsSL https://bun.sh/install | bash
版本 ≥ 1.3.0```
📥 安装步骤
1️⃣ 克隆项目
git clone https://github.com/yourusername/elysia-image-board.git
cd elysia-image-board
2️⃣ 安装依赖
bun install
3️⃣ 配置环境变量（可选）

创建 .env

JWT_SECRET=your-secret

默认值：

dev-secret-key
4️⃣ 启动开发服务器
bun run dev

访问：

http://localhost:3000
👑 设置管理员

首次启动后执行：

sqlite3 users.db "UPDATE users SET role='admin' WHERE username='你的用户名';"

重新登录即可获得管理员权限。

📁 项目结构
.
├── public/          # 静态前端
├── uploads/         # 图片上传目录（自动生成）
├── users.db         # SQLite 数据库
├── index.ts         # 主入口
├── package.json
├── README.md
└── .env.example
📚 API Overview

Base URL:

http://localhost:3000
🔓 公开接口
Method	Endpoint	说明
POST	/sign_up	注册
POST	/sign_in	登录
GET	/images	浏览图片
GET	/images/:id	图片详情
GET	/users/:username	用户主页
🔐 用户接口
Method	Endpoint
GET	/me
GET	/me/upload-quota
POST	/images
POST	/images/:id/like
POST	/collections
GET	/me/collections
POST	/users/:username/follow
👑 管理员接口
Method	Endpoint
GET	/admin/stats
GET	/admin/images
POST	/admin/images/:id/review
POST	/admin/images/batch-review
GET	/admin/users
⚙️ 可自定义配置
📊 每日上传限额

修改：

DAILY_LIMIT_BYTES

默认：

50MB
🖼️ 单图大小限制

修改 /images 路由中的：

10 * 1024 * 1024
🗄️ 数据库路径
new Database('users.db')
🧪 测试

目前无自动化测试。

可使用：

Bruno

Postman

导入 API 手动测试。

📄 License

MIT