import { Elysia, t } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { jwt } from '@elysiajs/jwt';
import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import sharp from 'sharp';

await mkdir('uploads', { recursive: true });

const db = new Database('users.db');

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    is_banned     INTEGER NOT NULL DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
try { db.run(`ALTER TABLE users ADD COLUMN email TEXT UNIQUE`); }     catch {}
try { db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`); } catch {}
try { db.run(`ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0`); } catch {}

db.run(`
  CREATE TABLE IF NOT EXISTS images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    title         TEXT,
    description   TEXT,
    filename      TEXT NOT NULL,
    width         INTEGER,
    height        INTEGER,
    file_size     INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'approved',
    reject_reason TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);
try { db.run(`ALTER TABLE images ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0`); }    catch {}
try { db.run(`ALTER TABLE images ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`); } catch {}
try { db.run(`ALTER TABLE images ADD COLUMN reject_reason TEXT`); }                       catch {}

db.run(`CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)`);
db.run(`CREATE TABLE IF NOT EXISTS image_tags (image_id INTEGER, tag_id INTEGER, PRIMARY KEY (image_id,tag_id), FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE)`);
db.run(`CREATE TABLE IF NOT EXISTS likes (user_id INTEGER, image_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id,image_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE)`);
db.run(`CREATE TABLE IF NOT EXISTS collections (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, is_public INTEGER NOT NULL DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
db.run(`CREATE TABLE IF NOT EXISTS collection_images (collection_id INTEGER, image_id INTEGER, added_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (collection_id,image_id), FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE, FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE)`);
db.run(`CREATE TABLE IF NOT EXISTS follows (follower_id INTEGER, following_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (follower_id,following_id), FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE)`);

const DAILY_LIMIT_BYTES = 50 * 1024 * 1024;

const userExists  = (u: string) => !!db.query('SELECT id FROM users WHERE username=?').get(u);
const emailExists = (e: string) => !!db.query('SELECT id FROM users WHERE email=?').get(e);
const findUser = (v: string) => {
  const sql = v.includes('@')
    ? 'SELECT id,username,email,password_hash,role,is_banned FROM users WHERE email=?'
    : 'SELECT id,username,email,password_hash,role,is_banned FROM users WHERE username=?';
  return db.query(sql).get(v) as { id:number; username:string; email:string|null; password_hash:string; role:string; is_banned:number } | null;
};
const createUser = (username: string, hash: string, email?: string) =>
  db.query('INSERT INTO users (username,password_hash,email) VALUES (?,?,?)').run(username, hash, email||null);
const getTodayUsage = (uid: number) =>
  (db.query(`SELECT COALESCE(SUM(file_size),0) AS used FROM images WHERE user_id=? AND DATE(created_at)=DATE('now','localtime')`).get(uid) as {used:number}).used;
const isAdmin = (uid: number) =>
  (db.query('SELECT role FROM users WHERE id=?').get(uid) as {role:string}|null)?.role === 'admin';

const IMAGE_SELECT = `
  SELECT i.*, u.username,
    (SELECT COUNT(*) FROM likes WHERE image_id=i.id) AS like_count,
    (SELECT COUNT(*) FROM collection_images WHERE image_id=i.id) AS collect_count,
    EXISTS(SELECT 1 FROM likes WHERE image_id=i.id AND user_id=?) AS liked
  FROM images i JOIN users u ON u.id=i.user_id
`;

const app = new Elysia()
  .use(staticPlugin({ assets:'public',  prefix:'/' }))
  .use(staticPlugin({ assets:'uploads', prefix:'/uploads' }))
  .use(jwt({ name:'jwt', secret: process.env.JWT_SECRET || 'dev-secret-key' }))
  .derive(async ({ headers, jwt }) => {
    const auth = headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const p = await jwt.verify(auth.slice(7));
      if (p?.userId) return { user: { userId:p.userId as number, username:p.username as string } };
    }
    return { user: null as null | { userId:number; username:string } };
  })

  .get('/', ({ redirect }) => redirect('/index.html'))

  .post('/sign_up', async ({ body }) => {
    const { username, email, password, confirm_password } = body;
    if (!username||!password||!confirm_password) return { success:false, message:'必填项不能为空' };
    if (password !== confirm_password) return { success:false, message:'两次密码不一致' };
    if (password.length < 6) return { success:false, message:'密码至少6位' };
    if (userExists(username)) return { success:false, message:'用户名已存在' };
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success:false, message:'邮箱格式不正确' };
      if (emailExists(email)) return { success:false, message:'邮箱已被注册' };
    }
    const hash = await Bun.password.hash(password);
    createUser(username, hash, email||undefined);
    return { success:true, message:'注册成功' };
  }, { body: t.Object({ username:t.String({minLength:1}), email:t.Optional(t.String()), password:t.String({minLength:6}), confirm_password:t.String() }) })

  .post('/sign_in', async ({ body, jwt, set }) => {
    const { login, password } = body;
    const user = findUser(login);
    if (!user) { set.status=401; return { success:false, message:'用户名/邮箱或密码错误' }; }
    if (user.is_banned) { set.status=403; return { success:false, message:'账号已被封禁，请联系管理员' }; }
    if (!await Bun.password.verify(password, user.password_hash)) { set.status=401; return { success:false, message:'用户名/邮箱或密码错误' }; }
    const token = await jwt.sign({ userId:user.id, username:user.username, role:user.role, exp:Math.floor(Date.now()/1000)+60*60*24*7 });
    return { success:true, token, username:user.username, role:user.role };
  }, { body: t.Object({ login:t.String({minLength:1}), password:t.String() }) })

  .get('/me', ({ user, set }) => {
    if (!user) { set.status=401; return { message:'未认证' }; }
    return db.query('SELECT id,username,role,is_banned FROM users WHERE id=?').get(user.userId) || { message:'用户不存在' };
  })

  .get('/me/upload-quota', ({ user, set }) => {
    if (!user) { set.status=401; return { message:'未认证' }; }
    const used = getTodayUsage(user.userId);
    return { used, limit:DAILY_LIMIT_BYTES, remaining:Math.max(0,DAILY_LIMIT_BYTES-used),
      usedMB:(used/1024/1024).toFixed(2), limitMB:'50.00', remainingMB:(Math.max(0,DAILY_LIMIT_BYTES-used)/1024/1024).toFixed(2) };
  })
  
  .post('/images', async ({ body, user, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    const u = db.query('SELECT is_banned FROM users WHERE id=?').get(user.userId) as any;
    if (u?.is_banned) { set.status=403; return { message:'账号已封禁' }; }
    const { file, title, description, tags } = body as { file:File; title?:string; description?:string; tags?:string };
    if (!file||!file.type.startsWith('image/')) { set.status=400; return { message:'请上传有效图片' }; }
    if (file.size > 10*1024*1024) { set.status=400; return { message:'单张图片 ≤ 10MB' }; }
    const todayUsed = getTodayUsage(user.userId);
    if (todayUsed+file.size > DAILY_LIMIT_BYTES) { set.status=429; return { message:`今日额度不足，剩余 ${((DAILY_LIMIT_BYTES-todayUsed)/1024/1024).toFixed(2)}MB` }; }
    const ext = extname(file.name);
    const filename = `${randomUUID()}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await Bun.write(`uploads/${filename}`, buffer);
    const meta = await sharp(buffer).metadata();
    const info = db.prepare(`INSERT INTO images (user_id,title,description,filename,width,height,file_size,status) VALUES (?,?,?,?,?,?,?,?)`)
      .run(user.userId, title||null, description||null, filename, meta.width||0, meta.height||0, file.size, 'pending');
    const imageId = info.lastInsertRowid;
    
    if (tags) {
      for (const tagName of tags.split(',').map(t=>t.trim()).filter(Boolean)) {
        db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tagName]);
        const tagRow = db.query('SELECT id FROM tags WHERE name=?').get(tagName) as {id:number};
        if (tagRow) db.run('INSERT OR IGNORE INTO image_tags VALUES (?,?)', [imageId, tagRow.id]);
      }
    }
    return { success:true, imageId };
  })

  .get('/images', ({ query, user }) => {
    const uid=user?.userId??0, page=Number(query.page)||1, limit=Number(query.limit)||20, offset=(page-1)*limit;
    const tag=query.tag as string|undefined, q=query.q as string|undefined, sort=(query.sort as string)||'latest';
    const conds=['i.status = \'approved\'']; const params:any[]=[uid];
    let sql=IMAGE_SELECT;
    if (tag) { sql+=` JOIN image_tags it ON it.image_id=i.id JOIN tags t ON t.id=it.tag_id`; conds.push(`t.name=?`); params.push(tag); }
    if (q)   { conds.push(`(i.title LIKE ? OR i.description LIKE ?)`); params.push(`%${q}%`,`%${q}%`); }
    sql+=` WHERE ${conds.join(' AND ')}`;
    if (sort==='hot') sql+=` ORDER BY like_count DESC, i.created_at DESC`;
    else if (sort==='random') sql+=` ORDER BY RANDOM()`;
    else sql+=` ORDER BY i.created_at DESC`;
    sql+=` LIMIT ? OFFSET ?`; params.push(limit,offset);
    return { success:true, images:db.query(sql).all(...params) };
  })

  .get('/images/:id', ({ params, user, set }) => {
    const uid=user?.userId??0;
    const image=db.query(`${IMAGE_SELECT} WHERE i.id=? AND i.status='approved'`).get(uid,params.id);
    if (!image) { set.status=404; return { message:'图片不存在' }; }
    const tags=db.query(`SELECT t.name FROM tags t JOIN image_tags it ON it.tag_id=t.id WHERE it.image_id=?`).all(params.id);
    return { ...(image as object), tags:tags.map((r:any)=>r.name) };
  })

  .post('/images/:id/like', ({ params, user, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    const imageId=Number(params.id);
    if (!db.query('SELECT id FROM images WHERE id=?').get(imageId)) { set.status=404; return { message:'图片不存在' }; }
    const liked=db.query('SELECT 1 FROM likes WHERE user_id=? AND image_id=?').get(user.userId,imageId);
    if (liked) db.run('DELETE FROM likes WHERE user_id=? AND image_id=?',[user.userId,imageId]);
    else       db.run('INSERT INTO likes (user_id,image_id) VALUES (?,?)',[user.userId,imageId]);
    const cnt=(db.query('SELECT COUNT(*) AS count FROM likes WHERE image_id=?').get(imageId) as {count:number}).count;
    return { success:true, liked:!liked, like_count:cnt };
  })

  .post('/collections', ({ body, user, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    const { name, description, is_public }=body as any;
    if (!name) { set.status=400; return { message:'名称不能为空' }; }
    const info=db.prepare('INSERT INTO collections (user_id,name,description,is_public) VALUES (?,?,?,?)').run(user.userId,name,description||null,is_public!==false?1:0);
    return { success:true, collectionId:info.lastInsertRowid };
  })

  .get('/me/collections', ({ user, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    return { success:true, collections:db.query(`SELECT c.*,(SELECT COUNT(*) FROM collection_images WHERE collection_id=c.id) AS image_count,(SELECT filename FROM images WHERE id=(SELECT image_id FROM collection_images WHERE collection_id=c.id ORDER BY added_at ASC LIMIT 1)) AS cover_filename FROM collections c WHERE c.user_id=? ORDER BY c.created_at DESC`).all(user.userId) };
  })

  .get('/users/:username/collections', ({ params }) => {
    const u=db.query('SELECT id FROM users WHERE username=?').get(params.username) as {id:number}|null;
    if (!u) return { success:false, message:'用户不存在' };
    return { success:true, collections:db.query(`SELECT c.*,(SELECT COUNT(*) FROM collection_images WHERE collection_id=c.id) AS image_count,(SELECT filename FROM images WHERE id=(SELECT image_id FROM collection_images WHERE collection_id=c.id ORDER BY added_at ASC LIMIT 1)) AS cover_filename FROM collections c WHERE c.user_id=? AND c.is_public=1 ORDER BY c.created_at DESC`).all(u.id) };
  })

  .get('/collections/:id/images', ({ params, user }) => {
    const col=db.query('SELECT * FROM collections WHERE id=?').get(params.id) as any;
    if (!col) return { success:false, message:'收藏夹不存在' };
    if (!col.is_public&&(!user||user.userId!==col.user_id)) return { success:false, message:'无权访问' };
    return { success:true, collection:col, images:db.query(`${IMAGE_SELECT} JOIN collection_images ci ON ci.image_id=i.id WHERE ci.collection_id=? ORDER BY ci.added_at DESC`).all(user?.userId??0,params.id) };
  })

  .post('/collections/:id/images', ({ params, body, user, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    const col=db.query('SELECT * FROM collections WHERE id=?').get(params.id) as any;
    if (!col) { set.status=404; return { message:'收藏夹不存在' }; }
    if (col.user_id!==user.userId) { set.status=403; return { message:'无权操作' }; }
    const { image_id }=body as { image_id:number };
    try { db.run('INSERT INTO collection_images (collection_id,image_id) VALUES (?,?)',[params.id,image_id]); return { success:true }; }
    catch { db.run('DELETE FROM collection_images WHERE collection_id=? AND image_id=?',[params.id,image_id]); return { success:true, removed:true }; }
  }, { body: t.Object({ image_id:t.Number() }) })

  .delete('/collections/:id', ({ params, user, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    const col=db.query('SELECT * FROM collections WHERE id=?').get(params.id) as any;
    if (!col) { set.status=404; return { message:'收藏夹不存在' }; }
    if (col.user_id!==user.userId) { set.status=403; return { message:'无权操作' }; }
    db.run('DELETE FROM collections WHERE id=?',[params.id]);
    return { success:true };
  })

  .get('/images/:id/my-collections', ({ params, user, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    return { success:true, collections:db.query(`SELECT c.id,c.name,EXISTS(SELECT 1 FROM collection_images WHERE collection_id=c.id AND image_id=?) AS collected FROM collections c WHERE c.user_id=? ORDER BY c.created_at DESC`).all(params.id,user.userId) };
  })

  .post('/users/:username/follow', ({ params, user, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    const target=db.query('SELECT id FROM users WHERE username=?').get(params.username) as {id:number}|null;
    if (!target) { set.status=404; return { message:'用户不存在' }; }
    if (target.id===user.userId) { set.status=400; return { message:'不能关注自己' }; }
    try { db.run('INSERT INTO follows (follower_id,following_id) VALUES (?,?)',[user.userId,target.id]); return { followed:true }; }
    catch { db.run('DELETE FROM follows WHERE follower_id=? AND following_id=?',[user.userId,target.id]); return { followed:false }; }
  })

  .get('/users/:username/followers', ({ params }) => {
    const u=db.query('SELECT id FROM users WHERE username=?').get(params.username) as {id:number}|null;
    if (!u) return { success:false, message:'用户不存在' };
    return { success:true, followers:db.query(`SELECT u.id,u.username,(SELECT COUNT(*) FROM follows WHERE following_id=u.id) AS follower_count FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=? ORDER BY f.created_at DESC`).all(u.id) };
  })

  .get('/users/:username/following', ({ params }) => {
    const u=db.query('SELECT id FROM users WHERE username=?').get(params.username) as {id:number}|null;
    if (!u) return { success:false, message:'用户不存在' };
    return { success:true, following:db.query(`SELECT u.id,u.username,(SELECT COUNT(*) FROM follows WHERE following_id=u.id) AS follower_count FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=? ORDER BY f.created_at DESC`).all(u.id) };
  })

  .get('/users/:username', ({ params, user }) => {
    const u=db.query(`SELECT id,username,created_at,(SELECT COUNT(*) FROM images WHERE user_id=id AND status='approved') AS image_count,(SELECT COUNT(*) FROM follows WHERE following_id=id) AS follower_count,(SELECT COUNT(*) FROM follows WHERE follower_id=id) AS following_count FROM users WHERE username=?`).get(params.username) as any;
    if (!u) return { success:false, message:'用户不存在' };
    const is_following=user&&user.userId!==u.id?!!db.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(user.userId,u.id):false;
    return { success:true, user:{ ...u, is_following } };
  })

  .get('/feed/following', ({ user, query, set }) => {
    if (!user) { set.status=401; return { message:'请先登录' }; }
    const page=Number(query.page)||1,limit=Number(query.limit)||20,offset=(page-1)*limit;
    return { success:true, images:db.query(`${IMAGE_SELECT} WHERE i.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) AND i.status='approved' ORDER BY i.created_at DESC LIMIT ? OFFSET ?`).all(user.userId,user.userId,limit,offset) };
  })

  .get('/users/:username/images', ({ params }) => {
    const u=db.query('SELECT id FROM users WHERE username=?').get(params.username) as {id:number}|null;
    if (!u) return { success:false, message:'用户不存在' };
    return { success:true, images:db.query(`${IMAGE_SELECT} WHERE i.user_id=? AND i.status='approved' ORDER BY i.created_at DESC`).all(0,u.id) };
  })

  // ════════════════════════════════════════════════════
  //  ADMIN API
  // ════════════════════════════════════════════════════

  .get('/admin/stats', ({ user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    return { success:true, stats:{
      users:       (db.query('SELECT COUNT(*) AS c FROM users').get() as any).c,
      images:      (db.query('SELECT COUNT(*) AS c FROM images').get() as any).c,
      pending:     (db.query(`SELECT COUNT(*) AS c FROM images WHERE status='pending'`).get() as any).c,
      approved:    (db.query(`SELECT COUNT(*) AS c FROM images WHERE status='approved'`).get() as any).c,
      rejected:    (db.query(`SELECT COUNT(*) AS c FROM images WHERE status='rejected'`).get() as any).c,
      likes:       (db.query('SELECT COUNT(*) AS c FROM likes').get() as any).c,
      collections: (db.query('SELECT COUNT(*) AS c FROM collections').get() as any).c,
      banned:      (db.query('SELECT COUNT(*) AS c FROM users WHERE is_banned=1').get() as any).c,
      today_uploads:(db.query(`SELECT COUNT(*) AS c FROM images WHERE DATE(created_at)=DATE('now','localtime')`).get() as any).c,
      today_users:  (db.query(`SELECT COUNT(*) AS c FROM users WHERE DATE(created_at)=DATE('now','localtime')`).get() as any).c,
    }};
  })

  .get('/admin/images', ({ query, user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    const page=Number(query.page)||1,limit=Number(query.limit)||20,offset=(page-1)*limit;
    const status=(query.status as string)||'pending', q=query.q as string|undefined;
    let sql=`SELECT i.*,u.username,(SELECT COUNT(*) FROM likes WHERE image_id=i.id) AS like_count FROM images i JOIN users u ON u.id=i.user_id`;
    const conds:string[]=[],params:any[]=[];
    if (status!=='all') { conds.push(`i.status=?`); params.push(status); }
    if (q) { conds.push(`(i.title LIKE ? OR i.description LIKE ? OR u.username LIKE ?)`); params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
    if (conds.length) sql+=` WHERE ${conds.join(' AND ')}`;
    sql+=` ORDER BY i.created_at DESC LIMIT ? OFFSET ?`; params.push(limit,offset);
    const countSql=`SELECT COUNT(*) AS c FROM images i JOIN users u ON u.id=i.user_id${conds.length?' WHERE '+conds.join(' AND '):''}`;
    const total=(db.query(countSql).get(...params.slice(0,-2)) as any).c;
    return { success:true, images:db.query(sql).all(...params), total };
  })

  .post('/admin/images/:id/review', ({ params, body, user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    const { action, reason }=body as { action:string; reason?:string };
    if (!['approve','reject'].includes(action)) { set.status=400; return { message:'action 必须是 approve 或 reject' }; }
    if (!db.query('SELECT id FROM images WHERE id=?').get(params.id)) { set.status=404; return { message:'图片不存在' }; }
    const newStatus=action==='approve'?'approved':'rejected';
    db.run('UPDATE images SET status=?,reject_reason=? WHERE id=?',[newStatus,reason||null,params.id]);
    return { success:true, status:newStatus };
  }, { body: t.Object({ action:t.String(), reason:t.Optional(t.String()) }) })

  .post('/admin/images/batch-review', ({ body, user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    const { ids, action, reason }=body as { ids:number[]; action:string; reason?:string };
    if (!ids?.length) { set.status=400; return { message:'ids 不能为空' }; }
    const newStatus=action==='approve'?'approved':'rejected';
    db.run(`UPDATE images SET status=?,reject_reason=? WHERE id IN (${ids.map(()=>'?').join(',')})`, [newStatus,reason||null,...ids]);
    return { success:true, updated:ids.length, status:newStatus };
  }, { body: t.Object({ ids:t.Array(t.Number()), action:t.String(), reason:t.Optional(t.String()) }) })

  .delete('/admin/images/:id', ({ params, user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    if (!db.query('SELECT id FROM images WHERE id=?').get(params.id)) { set.status=404; return { message:'图片不存在' }; }
    db.run('DELETE FROM images WHERE id=?',[params.id]);
    return { success:true };
  })

  .get('/admin/users', ({ query, user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    const page=Number(query.page)||1,limit=Number(query.limit)||20,offset=(page-1)*limit;
    const q=query.q as string|undefined;
    let sql=`SELECT id,username,email,role,is_banned,created_at,(SELECT COUNT(*) FROM images WHERE user_id=users.id) AS image_count FROM users`;
    const params:any[]=[];
    if (q) { sql+=` WHERE username LIKE ? OR email LIKE ?`; params.push(`%${q}%`,`%${q}%`); }
    sql+=` ORDER BY created_at DESC LIMIT ? OFFSET ?`; params.push(limit,offset);
    const total=(db.query(`SELECT COUNT(*) AS c FROM users${q?' WHERE username LIKE ? OR email LIKE ?':''}`).get(...(q?[`%${q}%`,`%${q}%`]:[])) as any).c;
    return { success:true, users:db.query(sql).all(...params), total };
  })

  .post('/admin/users/:id/ban', ({ params, body, user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    const { ban }=body as { ban:boolean };
    const target=db.query('SELECT id,role FROM users WHERE id=?').get(params.id) as any;
    if (!target) { set.status=404; return { message:'用户不存在' }; }
    if (target.role==='admin') { set.status=400; return { message:'不能封禁管理员' }; }
    if (Number(params.id)===user.userId) { set.status=400; return { message:'不能封禁自己' }; }
    db.run('UPDATE users SET is_banned=? WHERE id=?',[ban?1:0,params.id]);
    return { success:true, is_banned:ban };
  }, { body: t.Object({ ban:t.Boolean() }) })

  .post('/admin/users/:id/role', ({ params, body, user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    const { role }=body as { role:string };
    if (!['user','admin'].includes(role)) { set.status=400; return { message:'role 必须是 user 或 admin' }; }
    if (Number(params.id)===user.userId) { set.status=400; return { message:'不能修改自己的权限' }; }
    db.run('UPDATE users SET role=? WHERE id=?',[role,params.id]);
    return { success:true, role };
  }, { body: t.Object({ role:t.String() }) })

  .delete('/admin/users/:id', ({ params, user, set }) => {
    if (!user||!isAdmin(user.userId)) { set.status=403; return { message:'无权限' }; }
    const target=db.query('SELECT id,role FROM users WHERE id=?').get(params.id) as any;
    if (!target) { set.status=404; return { message:'用户不存在' }; }
    if (target.role==='admin') { set.status=400; return { message:'不能删除管理员' }; }
    if (Number(params.id)===user.userId) { set.status=400; return { message:'不能删除自己' }; }
    db.run('DELETE FROM users WHERE id=?',[params.id]);
    return { success:true };
  })

  .listen(3000);

console.log('🦊 Elysia is running at http://localhost:3000');

/*
  首次启动后，在终端执行以下命令将自己设为管理员：

  sqlite3 users.db "UPDATE users SET role='admin' WHERE username='你的用户名';"
*/