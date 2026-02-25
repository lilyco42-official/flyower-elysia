async function doUpload() {
  const file = document.getElementById('fileInput').files[0];
  if (!file) { toast('请先选择图片','err'); return; }
  
  const form = new FormData();
  form.append('file', file);
  form.append('title', document.getElementById('upTitle').value);
  form.append('description', document.getElementById('upDesc').value);
  form.append('tags', document.getElementById('upTags').value);

  try {
    const r = await fetch('/images', { method:'POST', headers:auth(), body:form });
    
    // 先检查响应状态
    if (!r.ok) {
      // 尝试获取错误信息（可能是 JSON 或纯文本）
      let errorMsg = `上传失败 (${r.status})`;
      try {
        const errData = await r.json(); // 如果后端返回 JSON 错误信息
        errorMsg = errData.message || errorMsg;
      } catch {
        // 如果解析 JSON 失败，则获取文本（可能是 HTML）
        const text = await r.text();
        errorMsg = text || errorMsg;
      }
      toast(errorMsg, 'err');
      return;
    }

    const d = await r.json();
    if (d.success) {
      toast('上传成功 ✦','ok');
      closeM('mUpload');
      // 重置表单
      document.getElementById('fileInput').value='';
      document.getElementById('previewImg').style.display='none';
      document.getElementById('upTitle').value='';
      document.getElementById('upDesc').value='';
      document.getElementById('upTags').value='';
      loadImages(true);
    } else {
      toast(d.message || '上传失败','err');
    }
  } catch (err) {
    toast('网络或服务器错误', 'err');
    console.error(err);
  }
}