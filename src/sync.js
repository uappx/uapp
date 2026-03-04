import _ from 'lodash'
import fs from 'fs-extra'
import path from 'path'
import chalk from 'chalk'
import chokidar from 'chokidar'

const notifyPriority = {
  error: 'high',
  copy: 'normal',
  remove: 'normal',
  watch: 'normal',
  'max-depth': 'low',
  'no-delete': 'low'
}

export default function (source, target, opts) {
  syncFiles(source, target, opts, function (event, data) {
    switch (event) {
      case 'error':
        console.error(chalk.bold.red(data.message || data))
        process.exit(data.code || 2)
        break

      case 'copy':
        console.log(
          '%s %s to %s',
          chalk.bold('COPY'),
          chalk.yellow(path.resolve(data[0])),
          chalk.yellow(path.resolve(data[1]))
        )
        break

      case 'remove':
        console.log('%s %s', chalk.bold('DELETE'), chalk.yellow(data))
        break

      case 'watch':
        console.log('%s %s', chalk.bold('WATCHING'), chalk.yellow(data))
        break

      case 'max-depth':
        console.log('%s: %s too deep', chalk.bold.dim('MAX-DEPTH'), chalk.yellow(data))
        break

      case 'no-delete':
        // console.log('keep: %s', chalk.yellow(data));
        break

      // Fallback: forgotten logs, displayed only in verbose mode
      default:
        if (argv.verbose) {
          console.log(event, data)
        }
    }
  })
}

function syncFiles(source, target, opts, notify) {
  opts = _.defaults(opts || {}, {
    watch: false,
    delete: false,
    depth: Infinity
  })

  if (typeof opts.depth !== 'number' || isNaN(opts.depth)) {
    notify('error', 'Expected valid number for option \'depth\'')
    return false
  }

  // Initial mirror
  var mirrored = mirror(source, target, opts, notify, 0)

  if (!mirrored) {
    return false
  }

  if (opts.watch) {
    // Watcher to keep in sync from that
    chokidar
      .watch(source, {
        persistent: true,
        depth: opts.depth,
        ignoreInitial: true
        // TODO "ignore": opts.ignore
      })
      //.on("raw", console.log.bind(console, "raw"))
      .on('ready', notify.bind(undefined, 'watch', source))
      .on('add', watcherCopy(source, target, opts, notify))
      .on('addDir', watcherCopy(source, target, opts, notify))
      .on('change', watcherCopy(source, target, opts, notify))
      .on('unlink', watcherDestroy(source, target, opts, notify))
      .on('unlinkDir', watcherDestroy(source, target, opts, notify))
      .on('error', watcherError(opts, notify))
  }
}

function watcherCopy(source, target, opts, notify) {
  return function (f, stats) {
    copy(f, path.join(target, path.relative(source, f)), notify)
  }
}

function watcherDestroy(source, target, opts, notify) {
  return function (f) {
    deleteExtra(path.join(target, path.relative(source, f)), opts, notify)
  }
}

function watcherError(opts, notify) {
  return function (err) {
    notify('error', err)
  }
}

function mirror(source, target, opts, notify, depth) {
  // Specifc case where the very source is gone
  var sourceStat
  try {
    sourceStat = fs.statSync(source)
  } catch (e) {
    // Source not found: destroy target?
    if (fs.existsSync(target)) {
      return deleteExtra(target, opts, notify)
    }
  }

  var targetStat
  try {
    targetStat = fs.statSync(target)
  } catch (e) {
    // Target not found? good, direct copy
    return copy(source, target, notify)
  }

  if (sourceStat.isDirectory() && targetStat.isDirectory()) {
    if (depth === opts.depth) {
      notify('max-depth', source)
      return true
    }

    // copy from source to target
    var copied = fs.readdirSync(source).every(function (f) {
      return mirror(path.join(source, f), path.join(target, f), opts, notify, depth + 1)
    })

    // check for extraneous
    var deletedExtra = fs.readdirSync(target).every(function (f) {
      return fs.existsSync(path.join(source, f)) || deleteExtra(path.join(target, f), opts, notify)
    })

    return copied && deletedExtra
  } else if (opts.delete) {
    // incompatible types: destroy target and copy
    return destroy(target, notify) && copy(source, target, notify)
  } else if (sourceStat.isFile() && targetStat.isFile()) {
    // compare update-time before overwriting
    if (sourceStat.mtime > targetStat.mtime || sourceStat.size !== targetStat.size) {
      return copy(source, target, notify)
    } else {
      return true
    }
  } else if (sourceStat.isFile() && targetStat.isDirectory()) {
    // incompatible types
    notify('error', 'Cannot copy file \'' + source + '\' to \'' + target + '\' as existing folder')
    return false
  } else if (sourceStat.isDirectory() && targetStat.isFile()) {
    // incompatible types
    notify('error', 'Cannot copy folder \'' + source + '\' to \'' + target + '\' as existing file')
    return false
  } else {
    throw new Error('Unexpected case: WTF?')
  }
}

function deleteExtra(fileordir, opts, notify) {
  if (opts.delete) {
    return destroy(fileordir, notify)
  } else {
    notify('no-delete', fileordir)
    return true
  }
}

function copy(source, target, notify) {
  notify('copy', [source, target])
  try {
    fs.copySync(source, target)
    return true
  } catch (e) {
    notify('error', e)
    return false
  }
}

function destroy(fileordir, notify) {
  notify('remove', fileordir)
  try {
    fs.removeSync(fileordir)
    return true
  } catch (e) {
    notify('error', e)
    return false
  }
}
