import { chromeAPI } from './chrome'
import { setPdfTabTitle } from './tab-title'

chromeAPI.action.onClicked.addListener(() => {
  void chromeAPI.tabs.create({ url: chromeAPI.runtime.getURL('welcome.html') })
})

chromeAPI.runtime.onMessage.addListener((message, sender) => {
  if ((message as { type?: string } | null)?.type === 'pdf-tab-title')
    return setPdfTabTitle(message, sender).catch(() => ({ changed: false }))
})
