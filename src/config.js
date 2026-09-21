import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const types = {
  'hbx.dir': 'directory',
  'wx.dir': 'directory',
  node: 'file'
}
const arity = { set: 3, get: 2, list: 1, delete: 2 }
const usage = '用法: uapp config set <key> <value> | get <key> | list | delete <key>'

export function readConfig(file) {
  if (!fs.existsSync(file)) return {}
  let config
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取配置文件 ${file}: ${error.message}`)
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`配置文件必须是 JSON 对象: ${file}`)
  }
  return config
}

export function configCommand(args, file) {
  if (!args.length) args = ['list']
  // Preserve the old write shorthand; a key without a value now reads instead of deleting.
  if (Object.hasOwn(types, args[0])) args = [args.length === 1 ? 'get' : 'set', ...args]
  const [action, key, value] = args
  if (!Object.hasOwn(arity, action) || args.length !== arity[action]) throw new Error(usage)
  if (action !== 'list' && !Object.hasOwn(types, key)) {
    throw new Error(`未知配置项 ${key}，支持: ${Object.keys(types).join(', ')}`)
  }

  const config = readConfig(file)
  if (action === 'list') return console.log(JSON.stringify(config, null, 2))
  if (action === 'get') {
    if (!Object.hasOwn(config, key)) throw new Error(`未配置 ${key}，请使用 uapp config set ${key} <value>`)
    return console.log(config[key])
  }
  if (action === 'delete') {
    if (!Object.hasOwn(config, key)) return console.log(`未配置 ${key}，无需删除`)
    delete config[key]
  } else {
    if (!value.trim()) throw new Error(`${key} 的值不能为空`)
    const resolved = path.resolve(value.replace(/^~(?=$|[\\/])/, () => os.homedir()))
    if (!fs.existsSync(resolved)) throw new Error(`${key} 路径不存在: ${resolved}`)
    const stat = fs.statSync(resolved)
    if (types[key] === 'directory' && !stat.isDirectory()) throw new Error(`${key} 必须指向目录: ${resolved}`)
    if (types[key] === 'file' && !stat.isFile()) throw new Error(`${key} 必须指向文件: ${resolved}`)
    config[key] = resolved
  }

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
  console.log(action === 'delete' ? `已移除配置 ${key}` : `已配置 ${key}: ${config[key]}`)
}
