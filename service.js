module.exports = {

  name: "Smart IPTV",

  async start(ctx){

    ctx.openApp({
      url: ctx.modulePath + "/app/index.html",
      fullscreen: true
    })

  }

}
