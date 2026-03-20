module.exports = {

  name: "tizentv",

  async start(ctx){

    ctx.openApp({
      url: ctx.modulePath + "/app/index.html",
      fullscreen: true
    })

  }

}
