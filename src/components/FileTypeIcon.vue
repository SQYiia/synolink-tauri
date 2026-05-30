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

// shadcn 风：纯色背景 + 单色描边图标，去掉渐变与浓饱和度
// 颜色采用扁平化柔和色，与 muted/border 调性一致
const ICONS: Record<string, IconDef> = {
  folder:  { from: '#3B82F6', to: '#3B82F6', icon: '' /* 用 FolderIcon 组件 */ },
  image:   { from: '#10B981', to: '#10B981', icon: 'photo-o' },
  video:   { from: '#8B5CF6', to: '#8B5CF6', icon: 'video-o' },
  audio:   { from: '#EC4899', to: '#EC4899', icon: 'music-o' },
  pdf:     { from: '#EF4444', to: '#EF4444', icon: 'description', badge: 'PDF' },
  archive: { from: '#F59E0B', to: '#F59E0B', icon: 'records' },
  doc:     { from: '#3B82F6', to: '#3B82F6', icon: 'description' },
  code:    { from: '#64748B', to: '#64748B', icon: 'orders-o' },
  text:    { from: '#6B7280', to: '#6B7280', icon: 'notes-o' },
  generic: { from: '#71717A', to: '#71717A', icon: 'description' },
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
      background: `${def.from}14`, /* 8% alpha tint */
      color: def.from,
    }"
  >
    <FolderIcon v-if="isDir" :size="iconSize" :color="def.from" />
    <van-icon v-else :name="def.icon" :size="iconSize" :color="def.from" />
    <span v-if="def.badge" class="ft-badge" :style="{ background: def.from }">{{ def.badge }}</span>
  </div>
</template>

<style scoped>
.ft {
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ft-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  font-size: 8px;
  font-weight: 600;
  color: #fff;
  border-radius: 3px;
  padding: 1px 3px;
  letter-spacing: 0.02em;
  line-height: 1.2;
  border: 1.5px solid hsl(var(--card));
}
</style>
