import { chromeAPI } from './chrome'

chromeAPI.action.onClicked.addListener(() => {
  void chromeAPI.tabs.create({ url: chromeAPI.runtime.getURL('welcome.html') })
})
