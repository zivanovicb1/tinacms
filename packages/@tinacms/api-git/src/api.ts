import { writeFile, deleteFile } from './file-writer'

import * as fs from 'fs'
import * as path from 'path'
import * as express from 'express'

import { commit } from './commit'
import { createUploader } from './upload'
import { openRepo } from './open-repo'
import { show } from './show'

export interface GitApiConfig {
  pathToRepo?: string
  pathToContent?: string
  defaultCommitMessage?: string
  defaultCommitName?: string
  defaultCommitEmail?: string
}

export class GitApi {
  REPO_ABSOLUTE_PATH: string
  CONTENT_REL_PATH: string
  CONTENT_ABSOLUTE_PATH: string
  TMP_DIR: string
  DEFAULT_COMMIT_MESSAGE: string
  config: GitApiConfig
  uploader: any

  constructor(config: GitApiConfig) {
    this.config = config
    this.REPO_ABSOLUTE_PATH = config.pathToRepo || process.cwd()
    this.CONTENT_REL_PATH = config.pathToContent || ''
    this.CONTENT_ABSOLUTE_PATH = path.join(this.REPO_ABSOLUTE_PATH, this.CONTENT_REL_PATH)
    this.TMP_DIR = path.join(this.CONTENT_ABSOLUTE_PATH, '/tmp/')
    this.DEFAULT_COMMIT_MESSAGE =
      config.defaultCommitMessage || 'Update from Tina'

    this.uploader = createUploader(this.TMP_DIR)
  }

  deleteFile = (req: express.Request, res: express.Response) => {
    const fileRelativePath = decodeURIComponent(req.params.relPath)
    const fileAbsolutePath = path.join(this.CONTENT_ABSOLUTE_PATH, fileRelativePath)

    try {
      deleteFile(fileAbsolutePath)
    } catch (e) {
      res.status(500).json({ status: 'error', message: e.message })
    }

    commit({
      pathRoot: this.REPO_ABSOLUTE_PATH,
      name: req.body.name || this.config.defaultCommitName,
      email: req.body.email || this.config.defaultCommitEmail,
      message: `Update from Tina: delete ${fileRelativePath}`,
      files: [fileAbsolutePath],
    })
      .then(() => {
        res.json({ status: 'success' })
      })
      .catch(e => {
        res.status(500).json({ status: 'error', message: e.message })
      })
  }

  createFile = (req: express.Request, res: express.Response) => {
    const fileRelativePath = decodeURIComponent(req.params.relPath)
    const fileAbsolutePath = path.join(this.CONTENT_ABSOLUTE_PATH, fileRelativePath)

    if (DEBUG) {
      console.log(fileAbsolutePath)
    }
    try {
      writeFile(fileAbsolutePath, req.body.content)
      res.json({ content: req.body.content })
    } catch (e) {
      res.status(500).json({ status: 'error', message: e.message })
    }
  }

  // TODO make this portable (currently requires middleware, see this.asRouter)
  handleUpload = (req: any, res: express.Response) => {
    try {
      const fileName = req.file.originalname
      const tmpPath = path.join(this.TMP_DIR, fileName)
      const finalPath = path.join(
        this.REPO_ABSOLUTE_PATH,
        req.body.directory,
        fileName
      )
      fs.rename(tmpPath, finalPath, (err: any) => {
        if (err) console.error(err)
      })
      res.send(req.file)
    } catch (e) {
      res.status(500).json({ status: 'error', message: e.message })
    }
  }

  commit = async (req: express.Request, res: express.Response) => {
    try {
      const message = req.body.message || this.DEFAULT_COMMIT_MESSAGE
      const files = req.body.files.map((rel: string) =>
        path.join(this.CONTENT_ABSOLUTE_PATH, rel)
      )

      // TODO: Separate commit and push???
      await commit({
        pathRoot: this.REPO_ABSOLUTE_PATH,
        name: req.body.name,
        email: req.body.email,
        message,
        files,
      })

      res.json({ status: 'success' })
    } catch (e) {
      // TODO: More intelligently respond
      res.status(412)
      res.json({ status: 'failure', error: e.message })
    }
  }

  reset = (req: express.Request, res: express.Response) => {
    let repo = openRepo(this.REPO_ABSOLUTE_PATH)
    const files = req.body.files.map((rel: string) =>
      path.join(this.CONTENT_ABSOLUTE_PATH, rel)
    )
    if (DEBUG) console.log(files)
    repo
      .checkout(files[0])
      .then(() => {
        res.json({ status: 'success' })
      })
      .catch((e: any) => {
        res.status(412)
        res.json({ status: 'failure', error: e.message })
      })
  }

  showContents = async (req: express.Request, res: express.Response) => {
    try {
      let fileRelativePath = path
        .join(this.CONTENT_REL_PATH, req.params.fileRelativePath)
        .replace(/^\/*/, '')

      let content = await show({
        pathRoot: this.REPO_ABSOLUTE_PATH,
        fileRelativePath,
      })

      res.json({
        fileRelativePath: req.params.fileRelativePath,
        content,
        status: 'success',
      })
    } catch (e) {
      res.status(501)
      res.json({
        status: 'failure',
        message: e.message,
        fileRelativePath: req.params.fileRelativePath,
      })
    }
  }

  asRouter() {
    const router = express.Router()
    router.use(express.json())
    router.delete('/:relPath', this.deleteFile)
    router.put('/:relPath', this.createFile)
    router.post('/upload', this.uploader.single('file'), this.handleUpload)
    router.post('/commit', this.commit)
    router.post('/reset', this.reset)
    router.get('/show/:fileRelativePath', this.showContents)
    return router
  }
}