import avatar01 from './assets/avatars/avatar_01_grandma.png';
import avatar02 from './assets/avatars/avatar_02_grandpa.png';
import avatar03 from './assets/avatars/avatar_03_doctor_male.png';
import avatar04 from './assets/avatars/avatar_04_doctor_female.png';
import avatar05 from './assets/avatars/avatar_05_father.png';
import avatar06 from './assets/avatars/avatar_06_mother.png';
import avatar07 from './assets/avatars/avatar_07_boy.png';
import avatar08 from './assets/avatars/avatar_08_girl.png';
import avatar09 from './assets/avatars/avatar_09_teen.png';
import avatar10 from './assets/avatars/avatar_10_lady.png';
import avatar11 from './assets/avatars/avatar_11_uncle.png';
import avatar12 from './assets/avatars/avatar_12_caregiver.png';
import avatar13 from './assets/avatars/avatar_13_toddler.png';
import avatar14 from './assets/avatars/avatar_14_dog.png';
import avatar15 from './assets/avatars/avatar_15_cat.png';
import avatar16 from './assets/avatars/avatar_16_robot.png';
import avatar17 from './assets/avatars/avatar_17_hebao.png';

// 17 款风格统一的 3D 黏土 / 皮克斯质感全家福与官方吉祥物头像库
// 共享 100x100 柔光视角、亲和色彩与治愈陶土拟物质感

export interface AvatarItem {
  id: string;
  name: string;
  role: string;
  bgColor: string;
  imgUrl: string;
  svg: string;
}

const STORAGE_KEY = 'medbox_user_avatar_id';

export const AVATAR_LIST: readonly AvatarItem[] = [
  {
    id: 'grandma_glasses',
    imgUrl: avatar01,
    name: '眼镜奶奶',
    role: '长辈',
    bgColor: '#eef2ff',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av1-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fed7aa"/><stop offset="100%" stop-color="#fba86b"/></linearGradient>
        <linearGradient id="av1-hair" x1="20" y1="10" x2="80" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#93c5fd"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient>
        <linearGradient id="av1-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fef08a"/><stop offset="100%" stop-color="#fde047"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#eef2ff"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av1-cloth)"/>
      <circle cx="50" cy="48" r="24" fill="url(#av1-skin)"/>
      <path d="M 26 44 C 24 24 40 18 50 18 C 60 18 76 24 74 44 C 68 34 60 30 50 30 C 40 30 32 34 26 44 Z" fill="url(#av1-hair)"/>
      <circle cx="42" cy="44" r="7.5" stroke="#f43f5e" stroke-width="2.5" fill="#ffffff" opacity="0.6"/>
      <circle cx="58" cy="44" r="7.5" stroke="#f43f5e" stroke-width="2.5" fill="#ffffff" opacity="0.6"/>
      <line x1="50" y1="44" x2="50" y2="44" stroke="#f43f5e" stroke-width="2"/>
      <circle cx="42" cy="44" r="2.5" fill="#1e1b4b"/>
      <circle cx="58" cy="44" r="2.5" fill="#1e1b4b"/>
      <path d="M 46 54 Q 50 58 54 54" stroke="#e11d48" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'grandpa_beard',
    imgUrl: avatar02,
    name: '白胡爷爷',
    role: '长辈',
    bgColor: '#f0fdf4',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av2-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fed7aa"/><stop offset="100%" stop-color="#ea580c"/></linearGradient>
        <linearGradient id="av2-hair" x1="20" y1="10" x2="80" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#94a3b8"/></linearGradient>
        <linearGradient id="av2-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#60a5fa"/><stop offset="100%" stop-color="#2563eb"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#f0fdf4"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av2-cloth)"/>
      <circle cx="50" cy="46" r="23" fill="url(#av2-skin)"/>
      <path d="M 28 42 C 26 26 40 20 50 20 C 60 20 74 26 72 42 C 68 34 60 30 50 30 C 40 30 32 34 28 42 Z" fill="url(#av2-hair)"/>
      <path d="M 38 48 C 38 48 40 64 50 64 C 60 64 62 48 62 48 C 58 54 54 55 50 55 C 46 55 42 54 38 48 Z" fill="#f8fafc"/>
      <circle cx="42" cy="42" r="2.5" fill="#1e1b4b"/>
      <circle cx="58" cy="42" r="2.5" fill="#1e1b4b"/>
      <path d="M 38 37 Q 43 35 46 37" stroke="#64748b" stroke-width="2" stroke-linecap="round"/>
      <path d="M 54 37 Q 57 35 62 37" stroke="#64748b" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'doctor_male',
    imgUrl: avatar03,
    name: '仁心医生',
    role: '医护',
    bgColor: '#ecfeff',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av3-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffedd5"/><stop offset="100%" stop-color="#fba86b"/></linearGradient>
        <linearGradient id="av3-hair" x1="20" y1="10" x2="80" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#475569"/><stop offset="100%" stop-color="#0f172a"/></linearGradient>
        <linearGradient id="av3-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#e2e8f0"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#ecfeff"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av3-cloth)"/>
      <path d="M 44 76 L 50 82 L 56 76 Z" fill="#06b6d4"/>
      <circle cx="50" cy="47" r="22" fill="url(#av3-skin)"/>
      <path d="M 30 42 C 30 24 40 22 50 22 C 60 22 70 24 70 42 C 65 32 58 32 50 32 C 42 32 35 32 30 42 Z" fill="url(#av3-hair)"/>
      <circle cx="43" cy="45" r="2.5" fill="#1e1b4b"/>
      <circle cx="57" cy="45" r="2.5" fill="#1e1b4b"/>
      <path d="M 46 53 Q 50 57 54 53" stroke="#e11d48" stroke-width="2" stroke-linecap="round" fill="none"/>
      <path d="M 36 68 C 36 78 64 78 64 68" stroke="#0891b2" stroke-width="3" stroke-linecap="round" fill="none"/>
      <circle cx="50" cy="78" r="3" fill="#0891b2"/>
    </svg>`,
  },
  {
    id: 'doctor_female',
    imgUrl: avatar04,
    name: '温柔护士',
    role: '医护',
    bgColor: '#fdf2f8',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av4-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff1f2"/><stop offset="100%" stop-color="#fda4af"/></linearGradient>
        <linearGradient id="av4-hair" x1="20" y1="10" x2="80" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7c2d12"/><stop offset="100%" stop-color="#451a03"/></linearGradient>
        <linearGradient id="av4-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fbcfe8"/><stop offset="100%" stop-color="#f472b6"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#fdf2f8"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av4-cloth)"/>
      <circle cx="50" cy="48" r="22" fill="url(#av4-skin)"/>
      <path d="M 28 46 C 26 28 40 24 50 24 C 60 24 74 28 72 46 C 68 36 60 34 50 34 C 40 34 32 36 28 46 Z" fill="url(#av4-hair)"/>
      <rect x="42" y="16" width="16" height="10" rx="3" fill="#ffffff" stroke="#f472b6" stroke-width="1.5"/>
      <path d="M 50 18 L 50 24 M 47 21 L 53 21" stroke="#f43f5e" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="43" cy="46" r="2.5" fill="#1e1b4b"/>
      <circle cx="57" cy="46" r="2.5" fill="#1e1b4b"/>
      <ellipse cx="38" cy="50" rx="3.5" ry="2" fill="#fda4af" opacity="0.6"/>
      <ellipse cx="62" cy="50" rx="3.5" ry="2" fill="#fda4af" opacity="0.6"/>
      <path d="M 46 54 Q 50 58 54 54" stroke="#e11d48" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'father_warm',
    imgUrl: avatar05,
    name: '暖心爸爸',
    role: '家人',
    bgColor: '#eff6ff',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av5-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fed7aa"/><stop offset="100%" stop-color="#fb923c"/></linearGradient>
        <linearGradient id="av5-hair" x1="20" y1="10" x2="80" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#78350f"/><stop offset="100%" stop-color="#451a03"/></linearGradient>
        <linearGradient id="av5-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#1d4ed8"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#eff6ff"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av5-cloth)"/>
      <circle cx="50" cy="48" r="23" fill="url(#av5-skin)"/>
      <path d="M 28 42 C 28 22 40 22 50 22 C 60 22 72 22 72 42 C 66 32 60 30 50 30 C 40 30 34 32 28 42 Z" fill="url(#av5-hair)"/>
      <circle cx="42" cy="45" r="2.5" fill="#1e1b4b"/>
      <circle cx="58" cy="45" r="2.5" fill="#1e1b4b"/>
      <path d="M 46 54 Q 50 58 54 54" stroke="#c2410c" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'mother_smile',
    imgUrl: avatar06,
    name: '知心妈妈',
    role: '家人',
    bgColor: '#fff7ed',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av6-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fed7aa"/><stop offset="100%" stop-color="#fba86b"/></linearGradient>
        <linearGradient id="av6-hair" x1="20" y1="10" x2="80" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#b45309"/><stop offset="100%" stop-color="#78350f"/></linearGradient>
        <linearGradient id="av6-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#f472b6"/><stop offset="100%" stop-color="#db2777"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#fff7ed"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av6-cloth)"/>
      <circle cx="50" cy="48" r="22" fill="url(#av6-skin)"/>
      <path d="M 26 48 C 24 24 40 22 50 22 C 60 22 76 24 74 48 C 70 34 60 32 50 32 C 40 32 30 34 26 48 Z" fill="url(#av6-hair)"/>
      <circle cx="28" cy="54" r="5" fill="url(#av6-hair)"/>
      <circle cx="72" cy="54" r="5" fill="url(#av6-hair)"/>
      <circle cx="43" cy="46" r="2.5" fill="#1e1b4b"/>
      <circle cx="57" cy="46" r="2.5" fill="#1e1b4b"/>
      <ellipse cx="38" cy="51" rx="3.5" ry="2" fill="#f43f5e" opacity="0.4"/>
      <ellipse cx="62" cy="51" rx="3.5" ry="2" fill="#f43f5e" opacity="0.4"/>
      <path d="M 46 54 Q 50 58 54 54" stroke="#e11d48" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'boy_glasses',
    imgUrl: avatar07,
    name: '活力男孩',
    role: '晚辈',
    bgColor: '#fefce8',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av7-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fed7aa"/><stop offset="100%" stop-color="#fba86b"/></linearGradient>
        <linearGradient id="av7-hair" x1="20" y1="10" x2="80" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#b45309"/></linearGradient>
        <linearGradient id="av7-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#059669"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#fefce8"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av7-cloth)"/>
      <circle cx="50" cy="48" r="21" fill="url(#av7-skin)"/>
      <path d="M 30 40 C 30 22 42 22 50 22 C 58 22 70 22 70 40 C 65 32 58 30 50 30 C 42 30 35 32 30 40 Z" fill="url(#av7-hair)"/>
      <circle cx="43" cy="46" r="6.5" stroke="#1e293b" stroke-width="2" fill="#ffffff" opacity="0.6"/>
      <circle cx="57" cy="46" r="6.5" stroke="#1e293b" stroke-width="2" fill="#ffffff" opacity="0.6"/>
      <line x1="49.5" y1="46" x2="50.5" y2="46" stroke="#1e293b" stroke-width="2"/>
      <circle cx="43" cy="46" r="2" fill="#1e1b4b"/>
      <circle cx="57" cy="46" r="2" fill="#1e1b4b"/>
      <path d="M 46 54 Q 50 58 54 54" stroke="#c2410c" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'girl_ponytail',
    imgUrl: avatar08,
    name: '马尾小妹',
    role: '晚辈',
    bgColor: '#faf5ff',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av8-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff1f2"/><stop offset="100%" stop-color="#fda4af"/></linearGradient>
        <linearGradient id="av8-hair" x1="20" y1="10" x2="80" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#6b21a8"/></linearGradient>
        <linearGradient id="av8-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#0284c7"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#faf5ff"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av8-cloth)"/>
      <ellipse cx="68" cy="22" rx="8" ry="12" fill="url(#av8-hair)" transform="rotate(30 68 22)"/>
      <circle cx="62" cy="26" r="4" fill="#f43f5e"/>
      <circle cx="50" cy="48" r="21" fill="url(#av8-skin)"/>
      <path d="M 28 44 C 28 26 40 24 50 24 C 60 24 72 26 72 44 C 66 34 60 32 50 32 C 40 32 34 34 28 44 Z" fill="url(#av8-hair)"/>
      <circle cx="43" cy="46" r="2.5" fill="#1e1b4b"/>
      <circle cx="57" cy="46" r="2.5" fill="#1e1b4b"/>
      <ellipse cx="38" cy="51" rx="3.5" ry="2" fill="#fda4af" opacity="0.8"/>
      <ellipse cx="62" cy="51" rx="3.5" ry="2" fill="#fda4af" opacity="0.8"/>
      <path d="M 46 54 Q 50 58 54 54" stroke="#e11d48" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'teen_student',
    imgUrl: avatar09,
    name: '清爽青年',
    role: '自用',
    bgColor: '#f1f5f9',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av9-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffedd5"/><stop offset="100%" stop-color="#fba86b"/></linearGradient>
        <linearGradient id="av9-hair" x1="20" y1="10" x2="80" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#334155"/><stop offset="100%" stop-color="#0f172a"/></linearGradient>
        <linearGradient id="av9-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#818cf8"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#f1f5f9"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av9-cloth)"/>
      <path d="M 28 48 C 28 66 72 66 72 48" stroke="#ffffff" stroke-width="5" stroke-linecap="round" fill="none"/>
      <circle cx="50" cy="47" r="22" fill="url(#av9-skin)"/>
      <path d="M 28 42 C 28 22 40 20 50 20 C 60 20 72 22 72 42 C 66 32 60 28 50 28 C 40 28 34 32 28 42 Z" fill="url(#av9-hair)"/>
      <circle cx="43" cy="45" r="2.5" fill="#1e1b4b"/>
      <circle cx="57" cy="45" r="2.5" fill="#1e1b4b"/>
      <path d="M 46 53 Q 50 57 54 53" stroke="#c2410c" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'young_lady',
    imgUrl: avatar10,
    name: '知性女性',
    role: '自用',
    bgColor: '#fdf4ff',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av10-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff1f2"/><stop offset="100%" stop-color="#fda4af"/></linearGradient>
        <linearGradient id="av10-hair" x1="20" y1="10" x2="80" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#581c87"/><stop offset="100%" stop-color="#3b0764"/></linearGradient>
        <linearGradient id="av10-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#2dd4bf"/><stop offset="100%" stop-color="#0f766e"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#fdf4ff"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av10-cloth)"/>
      <circle cx="50" cy="48" r="22" fill="url(#av10-skin)"/>
      <path d="M 26 48 C 24 26 40 22 50 22 C 60 22 76 26 74 48 C 72 58 64 34 50 34 C 36 34 28 58 26 48 Z" fill="url(#av10-hair)"/>
      <circle cx="43" cy="46" r="2.5" fill="#1e1b4b"/>
      <circle cx="57" cy="46" r="2.5" fill="#1e1b4b"/>
      <circle cx="28" cy="50" r="2.5" fill="#f59e0b"/>
      <circle cx="72" cy="50" r="2.5" fill="#f59e0b"/>
      <path d="M 46 54 Q 50 58 54 54" stroke="#e11d48" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'middle_aged_uncle',
    imgUrl: avatar11,
    name: '敦厚大叔',
    role: '长辈',
    bgColor: '#fef3c7',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av11-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fed7aa"/><stop offset="100%" stop-color="#ea580c"/></linearGradient>
        <linearGradient id="av11-hair" x1="20" y1="10" x2="80" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#020617"/></linearGradient>
        <linearGradient id="av11-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#d97706"/><stop offset="100%" stop-color="#92400e"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#fef3c7"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av11-cloth)"/>
      <circle cx="50" cy="48" r="23" fill="url(#av11-skin)"/>
      <path d="M 28 42 C 28 22 40 22 50 22 C 60 22 72 22 72 42 C 66 32 60 30 50 30 C 40 30 34 32 28 42 Z" fill="url(#av11-hair)"/>
      <circle cx="43" cy="45" r="2.5" fill="#1e1b4b"/>
      <circle cx="57" cy="45" r="2.5" fill="#1e1b4b"/>
      <path d="M 44 52 Q 50 54 56 52" stroke="#78350f" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M 46 56 Q 50 59 54 56" stroke="#c2410c" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'elderly_caregiver',
    imgUrl: avatar12,
    name: '护老天使',
    role: '照护',
    bgColor: '#ecfdf5',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av12-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffedd5"/><stop offset="100%" stop-color="#fba86b"/></linearGradient>
        <linearGradient id="av12-hair" x1="20" y1="10" x2="80" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#9a3412"/><stop offset="100%" stop-color="#7c2d12"/></linearGradient>
        <linearGradient id="av12-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#059669"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#ecfdf5"/>
      <path d="M 22 88 Q 50 68 78 88 Z" fill="url(#av12-cloth)"/>
      <circle cx="50" cy="48" r="22" fill="url(#av12-skin)"/>
      <path d="M 28 44 C 28 24 40 22 50 22 C 60 22 72 24 72 44 C 66 34 60 32 50 32 C 40 32 34 34 28 44 Z" fill="url(#av12-hair)"/>
      <circle cx="43" cy="46" r="2.5" fill="#1e1b4b"/>
      <circle cx="57" cy="46" r="2.5" fill="#1e1b4b"/>
      <path d="M 46 54 Q 50 58 54 54" stroke="#c2410c" stroke-width="2" stroke-linecap="round" fill="none"/>
      <circle cx="64" cy="74" r="5" fill="#f43f5e"/>
      <path d="M 64 72 L 64 76 M 62 74 L 66 74" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'little_toddler',
    imgUrl: avatar13,
    name: '萌萌小宝',
    role: '儿童',
    bgColor: '#fef9c3',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av13-skin" x1="30" y1="30" x2="70" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff1f2"/><stop offset="100%" stop-color="#fda4af"/></linearGradient>
        <linearGradient id="av13-cap" x1="20" y1="10" x2="80" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#facc15"/><stop offset="100%" stop-color="#eab308"/></linearGradient>
        <linearGradient id="av13-cloth" x1="20" y1="70" x2="80" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fb7185"/><stop offset="100%" stop-color="#e11d48"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#fef9c3"/>
      <path d="M 24 88 Q 50 68 76 88 Z" fill="url(#av13-cloth)"/>
      <circle cx="50" cy="50" r="23" fill="url(#av13-skin)"/>
      <path d="M 27 46 C 27 24 40 18 50 18 C 60 18 73 24 73 46 Z" fill="url(#av13-cap)"/>
      <circle cx="50" cy="15" r="5" fill="#fef08a"/>
      <circle cx="42" cy="48" r="3" fill="#1e1b4b"/>
      <circle cx="58" cy="48" r="3" fill="#1e1b4b"/>
      <circle cx="41" cy="47" r="1" fill="#ffffff"/>
      <circle cx="57" cy="47" r="1" fill="#ffffff"/>
      <ellipse cx="36" cy="53" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6"/>
      <ellipse cx="64" cy="53" rx="4" ry="2.5" fill="#f43f5e" opacity="0.6"/>
      <path d="M 47 56 Q 50 60 53 56" stroke="#e11d48" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'golden_retriever',
    imgUrl: avatar14,
    name: '暖心金毛',
    role: '萌宠',
    bgColor: '#fef3c7',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av14-fur" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fde047"/><stop offset="100%" stop-color="#d97706"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#fef3c7"/>
      <ellipse cx="28" cy="45" rx="8" ry="16" fill="#b45309" transform="rotate(15 28 45)"/>
      <ellipse cx="72" cy="45" rx="8" ry="16" fill="#b45309" transform="rotate(-15 72 45)"/>
      <circle cx="50" cy="50" r="26" fill="url(#av14-fur)"/>
      <ellipse cx="50" cy="58" rx="14" ry="10" fill="#fef9c3"/>
      <circle cx="40" cy="44" r="3.5" fill="#1e1b4b"/>
      <circle cx="60" cy="44" r="3.5" fill="#1e1b4b"/>
      <ellipse cx="50" cy="54" rx="5" ry="3.5" fill="#1e1b4b"/>
      <path d="M 50 57.5 C 50 62 46 62 46 60 M 50 57.5 C 50 62 54 62 54 60" stroke="#1e1b4b" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      <path d="M 48 62 Q 50 68 52 62 Z" fill="#f43f5e"/>
    </svg>`,
  },
  {
    id: 'calico_cat',
    imgUrl: avatar15,
    name: '治愈三花',
    role: '萌宠',
    bgColor: '#fae8ff',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av15-fur" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#f1f5f9"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#fae8ff"/>
      <path d="M 28 40 L 36 20 L 46 32 Z" fill="#f97316"/>
      <path d="M 72 40 L 64 20 L 54 32 Z" fill="#334155"/>
      <path d="M 32 38 L 36 24 L 42 32 Z" fill="#fecdd3"/>
      <path d="M 68 38 L 64 24 L 58 32 Z" fill="#fecdd3"/>
      <circle cx="50" cy="52" r="26" fill="url(#av15-fur)"/>
      <path d="M 58 26 C 68 28 74 36 74 46 C 70 48 64 42 62 34 Z" fill="#334155"/>
      <ellipse cx="40" cy="48" rx="3.5" ry="4.5" fill="#10b981"/>
      <ellipse cx="60" cy="48" rx="3.5" ry="4.5" fill="#10b981"/>
      <circle cx="40" cy="48" r="2" fill="#064e3b"/>
      <circle cx="60" cy="48" r="2" fill="#064e3b"/>
      <path d="M 48 56 L 52 56 L 50 58 Z" fill="#f43f5e"/>
      <path d="M 46 60 Q 50 63 54 60" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  {
    id: 'smart_pill_bot',
    imgUrl: avatar16,
    name: '药盒伙伴',
    role: '助手',
    bgColor: '#e0e7ff',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av16-bot" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#c7d2fe"/></linearGradient>
        <linearGradient id="av16-screen" x1="30" y1="35" x2="70" y2="65" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#1e1b4b"/><stop offset="100%" stop-color="#312e81"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#e0e7ff"/>
      <line x1="50" y1="18" x2="50" y2="28" stroke="#6366f1" stroke-width="3" stroke-linecap="round"/>
      <circle cx="50" cy="16" r="4" fill="#a855f7"/>
      <rect x="25" y="28" width="50" height="46" rx="20" fill="url(#av16-bot)"/>
      <rect x="31" y="36" width="38" height="26" rx="12" fill="url(#av16-screen)"/>
      <ellipse cx="42" cy="48" rx="3.5" ry="5" fill="#38bdf8"/>
      <ellipse cx="58" cy="48" rx="3.5" ry="5" fill="#38bdf8"/>
      <ellipse cx="43" cy="47" rx="1.5" ry="2" fill="#ffffff"/>
      <ellipse cx="59" cy="47" rx="1.5" ry="2" fill="#ffffff"/>
      <circle cx="23" cy="51" r="3.5" fill="#818cf8"/>
      <circle cx="77" cy="51" r="3.5" fill="#818cf8"/>
    </svg>`,
  },
  {
    id: 'hebao_mascot',
    imgUrl: avatar17,
    name: '盒宝',
    role: '吉祥物',
    bgColor: '#e6f7ef',
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="asset-3d-avatar">
      <defs>
        <linearGradient id="av17-body" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffffff"/><stop offset="50%" stop-color="#f0fdf4"/><stop offset="100%" stop-color="#dcfce7"/></linearGradient>
        <linearGradient id="av17-green" x1="20" y1="40" x2="80" y2="90" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#10b981"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#e6f7ef"/>
      <rect x="30" y="24" width="40" height="52" rx="20" fill="url(#av17-body)"/>
      <path d="M 30 50 A 20 20 0 0 0 70 50 L 70 56 A 20 20 0 0 1 30 56 Z" fill="url(#av17-green)"/>
      <circle cx="42" cy="42" r="3.5" fill="#1e293b"/>
      <circle cx="43.2" cy="40.8" r="1.2" fill="#ffffff"/>
      <circle cx="58" cy="42" r="3.5" fill="#1e293b"/>
      <circle cx="59.2" cy="40.8" r="1.2" fill="#ffffff"/>
      <ellipse cx="36" cy="47" rx="3" ry="1.8" fill="#fda4af" opacity="0.75"/>
      <ellipse cx="64" cy="47" rx="3" ry="1.8" fill="#fda4af" opacity="0.75"/>
      <path d="M 46 47 Q 50 51 54 47" stroke="#1e293b" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
] as const;

export function getAvatarList(): readonly AvatarItem[] {
  return AVATAR_LIST;
}

export function getActiveAvatarId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'grandma_glasses';
  } catch {
    return 'grandma_glasses';
  }
}

export function setActiveAvatarId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
    window.dispatchEvent(new CustomEvent('medbox:avatar-change', { detail: { id } }));
  } catch {
    // Storage might be restricted
  }
}

export function getAvatarById(id: string): AvatarItem {
  const found = AVATAR_LIST.find((a) => a.id === id);
  if (found) return found;
  return AVATAR_LIST[0] as AvatarItem;
}

export function getUserAvatarSvg(id?: string): string {
  const targetId = id || getActiveAvatarId();
  return getAvatarById(targetId).svg;
}


export function getUserAvatarImg(id?: string): string {
  const targetId = id || getActiveAvatarId();
  return getAvatarById(targetId).imgUrl;
}
