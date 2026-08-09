import { Navigate } from 'react-router-dom'

/** 单机主线已取消登录页，保留文件避免历史链接 404。 */
export function LoginPage() {
  return <Navigate to="/" replace />
}
