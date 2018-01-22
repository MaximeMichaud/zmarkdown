const toVFile = require('to-vfile')
const unified = require('unified')
const inspect = require('unist-util-inspect')
const visit = require('unist-util-visit')

const dedent = require('dedent')
const clone = require('clone')

const createWrapper = require('./utils/wrappers')
const remarkParse = require('remark-parse')

const remarkAbbr = require('remark-abbr/src')
const remarkAlign = require('remark-align/src')
const remarkCaptions = require('remark-captions/src')
const remarkComments = require('remark-comments/src')
const remarkCustomBlocks = require('remark-custom-blocks/src')
const remarkDisableTokenizers = require('remark-disable-tokenizers/src')
const remarkEmoticons = require('remark-emoticons/src')
const remarkEscapeEscaped = require('remark-escape-escaped/src')
const remarkGridTables = require('remark-grid-tables/src')
const remarkHeadingShifter = require('remark-heading-shift/src')
const remarkIframes = require('remark-iframes/src')
const remarkImagesDownload = require('remark-images-download/src')
const remarkKbd = require('remark-kbd/src')
const remarkMath = require('remark-math')
const remarkNumberedFootnotes = require('remark-numbered-footnotes/src')
const remarkPing = require('remark-ping/src')
const remarkSubSuper = require('remark-sub-super/src')
const remarkTextr = require('./plugins/remark-textr')
const remarkTrailingSpaceHeading = require('remark-heading-trailing-spaces')

const remark2rehype = require('remark-rehype')

const rehypeKatex = require('rehype-katex')
const rehypeFootnotesTitles = require('rehype-footnotes-title')
const rehypeHighlight = require('rehype-highlight')
const rehypeHTMLBlocks = require('rehype-html-blocks')
const rehypeAutolinkHeadings = require('rehype-autolink-headings')
const rehypeSlug = require('rehype-slug')

const rehypeStringify = require('rehype-stringify')

const rebberStringify = require('rebber/src')

const remarkConfig = require('./config/remark')
const rebberConfig = require('./config/rebber')

const fromFile = (filepath) => toVFile.readSync(filepath)
const jsFiddleAndInaFilter = node => {
  if (node.properties.src) {
    return node.properties.src.includes('jsfiddle.') || node.properties.src.includes('ina.')
  }
  return false
}

const wrappers = {
  iframe: [
    createWrapper(
      'iframe',
      ['div', 'div'],
      [['video-wrapper'], ['video-container']],
      node => !jsFiddleAndInaFilter(node)
    ),
    createWrapper('iframe', 'div', ['iframe-wrapper'], jsFiddleAndInaFilter),
  ],
  table: [
    createWrapper('table', 'div', ['table-wrapper']),
  ],
}

const zmdParser = (config, target) => {
  const mdProcessor = unified()
    .use(remarkParse, config.reParse)

  if (target !== 'latex' && !config.noTypography) {
    mdProcessor
      .use(remarkTextr, config.textr)
  }

  return mdProcessor
    .use(remarkAbbr)
    .use(remarkAlign, config.alignBlocks)
    .use(remarkCaptions, config.captions)
    .use(remarkComments)
    .use(remarkCustomBlocks, config.customBlocks)
    .use(remarkDisableTokenizers, config.disableTokenizers)
    .use(remarkEmoticons, config.emoticons)
    .use(remarkEscapeEscaped, config.escapeEscaped)
    .use(remarkGridTables)
    .use(remarkHeadingShifter, config.headingShifter)
    .use(remarkIframes, config.iframes)
    .use(remarkImagesDownload, config.imagesDownload)
    .use(remarkMath, config.math)
    .use(remarkKbd)
    .use(remarkNumberedFootnotes)
    .use(remarkPing, config.ping)
    .use(remarkSubSuper)
    .use(remarkTrailingSpaceHeading)
    .use(() => (tree, file) => {
      // if we don't have any headings, we add a flag to disable
      // the Table of Contents directly in the latex template
      file.data.disableToc = true
      visit(tree, 'heading', () => {
        file.data.disableToc = false
      })
    })
}

function getLatexProcessor (remarkConfig, rebberConfig, target) {
  remarkConfig.noTypography = true

  return zmdParser(remarkConfig, target)
    .use(rebberStringify, rebberConfig)
}

function getHTMLProcessor (remarkConfig, rebberConfig, target) {
  const parser = zmdParser(remarkConfig, target)
    .use(remark2rehype, remarkConfig.remark2rehype)

  if (!remarkConfig._test) {
    parser
      .use(rehypeHighlight, remarkConfig.rehypeHighlight)
  }

  return parser
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, remarkConfig.autolinkHeadings)
    .use(rehypeHTMLBlocks)
    .use(rehypeFootnotesTitles, remarkConfig.footnotesTitles)
    .use(rehypeKatex, remarkConfig.katex)
    .use(() => (tree) => {
      Object.keys(wrappers).forEach(nodeName =>
        wrappers[nodeName].forEach(wrapper => {
          visit(tree, wrapper)
        }))
    })
    .use(rehypeStringify)
}

const rendererFactory = ({remarkConfig, rebberConfig}, target = 'html') => (input, cb) => {
  [remarkConfig, rebberConfig] = [clone(remarkConfig), clone(rebberConfig)]

  const mdProcessor = target !== 'html'
    ? getLatexProcessor(remarkConfig, rebberConfig, target)
    : getHTMLProcessor(remarkConfig, rebberConfig, target)


  if (typeof cb !== 'function') {
    return new Promise((resolve, reject) =>
      mdProcessor.process(input, (err, vfile) => {
        if (err) return reject(err)

        resolve(vfile)
      }))
  }

  mdProcessor.process(input, (err, vfile) => {
    if (err) return cb(err)

    cb(null, vfile)
  })
}

const mdastParser = (opts) => (zmd) => zmdParser(opts.remarkConfig).parse(zmd)

module.exports = (
  opts = {remarkConfig, rebberConfig},
  target = 'html'
) => {
  if (!opts.remarkConfig || !Object.keys(remarkConfig).length) {
    throw new Error(dedent`
      This module expects to be called with ({remarkConfig, rebberConfig}, target = 'html'),
      remarkConfig is missing!`)
  }
  if (!opts.rebberConfig || !Object.keys(rebberConfig).length) {
    throw new Error(dedent`
      This module expects to be called with ({remarkConfig, rebberConfig}, target = 'html'),
      rebberConfig is missing!`)
  }
  return {
    config: opts,
    inspect: inspect,
    parse: mdastParser(opts),
    rendererFactory: rendererFactory,
    renderString: rendererFactory(opts, target),
    renderFile: (path, cb) => rendererFactory(opts, target)(fromFile(path), cb),
    latexDocumentTemplate: require('./templates/latex-document'),
  }
}
