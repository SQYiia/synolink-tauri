<script setup lang="ts">
import { computed } from 'vue'
import FolderIcon from './FolderIcon.vue'

const props = defineProps<{
  /** 文件名（用于推断扩展名） */
  name: string
  /** 是否目录（优先级最高） */
  isDir?: boolean
  /** 外框宽高，正方形，默认 40 */
  size?: number
  /** 圆角，默认 10 */
  radius?: number
}>()

interface IconDef {
  from: string
  to: string
  /** Vant 字体图标名（folder 例外，因为 Vant 没有 folder 图标） */
  icon: string
  /** 可选：右下角标签（PDF、ZIP 等） */
  badge?: string
}

// Vant 图标列表：https://vant-ui.github.io/vant/#/zh-CN/icon
// 注意：Vant 4 没有 folder 图标，所以 folder 用自定义 SVG
const ICONS: Record<string, IconDef> = {
  folder:  { from: '#5B8CFF', to: '#3163E5', icon: '' /* 用 FolderIcon 组件 */ },
  image:   { from: '#34D399', to: '#10B981', icon: 'photo-o' },
  video:   { from: '#A78BFA', to: '#8B5CF6', icon: 'video-o' },
  audio:   { from: '#F472B6', to: '#EC4899', icon: 'music-o' },
  pdf:     { from: '#F87171', to: '#EF4444', icon: 'description', badge: 'PDF' },
  archive: { from: '#FBBF24', to: '#F59E0B', icon: 'records' },
  doc:     { from: '#60A5FA', to: '#3B82F6', icon: 'description' },
  code:    { from: '#94A3B8', to: '#475569', icon: 'orders-o' },
  text:    { from: '#9CA3AF', to: '#6B7280', icon: 'notes-o' },
  generic: { from: '#9CA3AF', to: '#6B7280', icon: 'description' },
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic', 'heif']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ts', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp']
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'aiff']
const ARCHIVE_EXT = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz']
const CODE_EXT = ['js', 'ts', 'tsx', 'jsx', 'vue', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'rb', 'php', 'html', 'css', 'scss']
const TEXT_EXT = ['txt', 'md', 'log', 'json', 'xml', 'ini', 'conf', 'yml', 'yaml', 'csv']
const DOC_EXT = ['doc', 'docx', 'rtf', 'odt', 'ppt', 'pptx', 'xls', 'xlsx', 'ods']

function detect(name: string): keyof typeof ICONS {
  const ext = (name || '').toLowerCase().split('.').pop() ?? ''
  if (!ext) return 'generic'
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (ARCHIVE_EXT.includes(ext)) return 'archive'
  if (CODE_EXT.includes(ext)) return 'code'
  if (TEXT_EXT.includes(ext)) return 'text'
  if (DOC_EXT.includes(ext)) return 'doc'
  return 'generic'
}

const def = computed<IconDef>(() => {
  if (props.isDir) return ICONS.folder
  return ICONS[detect(props.name)]
})

const size = computed(() => props.size ?? 40)
const radius = computed(() => props.radius ?? 10)
const iconSize = computed(() => Math.round(size.value * 0.6))
</script>

<template>
  <div
    class="ft"
    :style="{
      width: size + 'px',
      height: size + 'px',
      borderRadius: radius + 'px',
      background: `linear-gradient(135deg, ${def.from}, ${def.to})`,
    }"
  >
    <FolderIcon v-if="isDir" :size="iconSize" color="white" />
    <van-icon v-else :name="def.icon" :size="iconSize" color="white" />
    <span v-if="def.badge" class="ft-badge">{{ def.badge }}</span>
  </div>
</template>

<style scoped>
.ft {
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  color: white;
}
.ft-badge {
  position: absolute;
  bottom: 1px;
  right: 1px;
  font-size: 8px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  background: rgba(0, 0, 0, 0.22);
  border-radius: 3px;
  padding: 0 3px;
  letter-spacing: 0.02em;
  line-height: 1.4;
}
</style>
