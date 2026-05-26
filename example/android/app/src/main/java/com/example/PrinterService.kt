class PrinterService : Service() {
    private lateinit var ws: WebSocket

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(
            1,
            createNotification()
        )
        startWebSocket()
        return START_STICKY
    }

    private fun startWebSocket() {
        val client = OkHttpClient()
        val request = Request.Builder().url("wss://voisely.com/ws").build()

        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, message: String) {
                val json = JSONObject(message)
                val url = json.getString("imageUrl")
                handlePrint(url)
            }
        })
    }

    private fun handlePrint(url: String) {
        // Download image
        // Convert to Base64
        // Use StarIO10 native API to print
        // (you already have this logic in JS — it's moved here)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}