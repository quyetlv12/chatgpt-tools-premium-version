import { Archive, FileJson2, KeyRound, PanelsTopLeft, ShieldCheck } from 'lucide-react'

export const modules = [
  { key: 'twofa', host: 'twofa', title: 'Tài khoản & 2FA', icon: ShieldCheck,
    category: 'BẢO MẬT', description: 'Kiểm tra tài khoản, đổi mật khẩu và quản lý xác thực hai bước.' },
  { key: 'export', host: 'export', title: 'Codex Export', icon: FileJson2,
    category: 'DỮ LIỆU', description: 'Xuất và chuyển đổi dữ liệu tài khoản cho các công cụ của bạn.' },
  { key: 'browser', host: 'browser', title: 'Browser Login', icon: PanelsTopLeft,
    category: 'TRÌNH DUYỆT', description: 'Mở trình duyệt đăng nhập và thao tác với workspace 9Router.' },
  { key: 'chat-backup', host: 'backup', title: 'Chat Backup', icon: Archive,
    category: 'LƯU TRỮ', description: 'Sao lưu và quản lý lịch sử trò chuyện trong một workspace riêng.' },
]

export const passkey = { key: 'passkey', host: 'twofa', path: '/passkey', title: 'Thêm Passkey', icon: KeyRound }
export const workspaces = [...modules, passkey]

// Fixed to the isolated copy. Never connect a React workspace to port 5050.
export const moduleUrl = (module) => `http://${module.host}.localhost:5150${module.path || '/'}`
