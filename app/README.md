Elysia Image Board
一个基于 Elysia 和 Bun 构建的轻量级图片分享社区。支持用户上传、点赞、收藏、关注以及管理员审核等功能，适合搭建自己的小型图站或学习参考。

https://img.shields.io/badge/Bun-1.3.9-000?logo=bun
https://img.shields.io/badge/Elysia-latest-8A2BE2
https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite

✨ 功能特性
用户端
注册 / 登录（支持用户名或邮箱）

JWT 身份验证

上传图片（支持标题、描述、标签）

每日上传限额（默认 50MB）

浏览图片（最新、最热、随机）

点赞 / 取消点赞

创建收藏夹（公开/私密）

将图片加入/移出收藏夹

关注 / 取消关注其他用户

查看个人主页（上传数、粉丝数、关注数）

查看关注用户的动态

管理员端
控制台统计（用户数、图片数、待审核等）

管理图片（审核通过/拒绝、批量操作、删除）

管理用户（封禁/解封、修改角色、删除用户）

查看所有待审核图片

审核流程
图片上传后默认状态为 pending，需要管理员审核通过（approved）后才会公开显示

被拒绝的图片可填写拒绝原因

🛠 技术栈
运行时：Bun 1.3+

框架：Elysia（高性能 Web 框架）

数据库：SQLite（通过 bun:sqlite）

图像处理：Sharp（获取图片尺寸）

身份验证：@elysiajs/jwt + Bun.password

静态服务：@elysiajs/static

🚀 快速开始
前置要求
安装 Bun（版本 ≥ 1.3.0）

安装步骤
克隆项目

bash
git clone https://github.com/yourusername/elysia-image-board.git
cd elysia-image-board
安装依赖

bash
bun install
配置环境变量（可选）
创建 .env 文件：

env
JWT_SECRET=你的密钥（默认使用 dev-secret-key）
启动开发服务器

bash
bun run dev
服务默认运行在 http://localhost:3000

访问应用
浏览器打开 http://localhost:3000，即可看到前端页面（需自行提供 public/index.html，或使用 Swagger UI 测试 API）。

👑 设置管理员
首次启动后，通过 SQLite 命令将已有用户设为管理员：

bash
sqlite3 users.db "UPDATE users SET role='admin' WHERE username='你的用户名';"
之后登录该账号即可访问所有管理员接口。

📁 项目结构
text
.
├── public/                 # 静态前端文件（需自行放置）
├── uploads/                # 用户上传的图片（自动生成）
├── users.db                # SQLite 数据库文件
├── index.ts                # 主入口文件（包含所有 API 路由）
├── package.json
├── README.md
└── .env.example
📚 API 概览
基础路径：http://localhost:3000

端点	方法	说明	权限
/sign_up	POST	注册	公开
/sign_in	POST	登录	公开
/me	GET	当前用户信息	登录用户
/me/upload-quota	GET	今日上传配额	登录用户
/images	POST	上传图片	登录用户
/images	GET	浏览公开图片（支持分页、标签、搜索、排序）	公开
/images/:id	GET	图片详情	公开
/images/:id/like	POST	点赞/取消点赞	登录用户
/collections	POST	创建收藏夹	登录用户
/me/collections	GET	我的收藏夹	登录用户
/users/:username	GET	用户主页	公开
/users/:username/follow	POST	关注/取关用户	登录用户
/admin/stats	GET	统计概览	管理员
/admin/images	GET	管理图片列表（支持状态过滤）	管理员
/admin/images/:id/review	POST	审核单张图片	管理员
/admin/images/batch-review	POST	批量审核	管理员
/admin/users	GET	管理用户列表	管理员
...	...	...	...
完整 API 文档可查看代码中的路由定义，或使用 Swagger UI（若集成）。

⚙️ 自定义配置
每日上传限额：修改代码中的 DAILY_LIMIT_BYTES 常量（默认 50MB）。

单图大小限制：修改 /images 路由中的 10*1024*1024。

数据库路径：new Database('users.db') 可改为其他路径。

🧪 测试
目前无自动化测试，可使用 Bruno 或 Postman 导入 API 进行手动测试。

📄 许可证
MIT