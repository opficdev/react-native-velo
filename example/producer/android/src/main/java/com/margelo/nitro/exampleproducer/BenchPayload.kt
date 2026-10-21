package com.margelo.nitro.exampleproducer

import java.nio.ByteBuffer

// 이벤트 크기 표와 JSON 템플릿
// 순번을 표 길이로 나눈 나머지 위치의 크기 사용
class BenchPayload private constructor(
    private val sizes: IntArray,
    private val fixedSize: Int,
    private val template: ByteArray,
    private val cuts: IntArray,
    // 0x5A 채우기와 JSON 뒤 공백 채우기에 쓰는 가장 큰 크기의 배열
    private val pad: ByteArray,
) {
    fun size(index: Long): Int = if (sizes.isEmpty()) fixedSize else sizes[(index % sizes.size).toInt()]

    // 16바이트 뒤 본문을 채우는 함수
    // 버퍼의 position은 16
    fun fill(
        bytes: ByteBuffer,
        index: Long,
        size: Int,
    ) {
        val length = size - 16
        if (template.isEmpty()) {
            bytes.put(pad, 0, length)
            return
        }
        val cut = cuts[if (sizes.isEmpty()) 0 else (index % sizes.size).toInt()]
        bytes.put(template, 0, cut)
        bytes.put(0x5D.toByte())
        bytes.put(pad, 0, length - cut - 1)
    }

    companion object {
        fun fixed(size: Int) = BenchPayload(IntArray(0), size, ByteArray(0), IntArray(0), ByteArray(size) { 0x5A })

        fun filled(
            sizes: IntArray,
            fixedSize: Int,
        ) = BenchPayload(sizes, fixedSize, ByteArray(0), IntArray(0), ByteArray(maxOf(sizes.maxOrNull() ?: 0, fixedSize)) { 0x5A })

        // 크기마다 레코드 경계까지만 복사하고 `]` 뒤를 공백으로 채워 유효한 JSON 유지
        fun json(
            sizes: IntArray,
            fixedSize: Int,
        ): BenchPayload {
            val longest = maxOf(sizes.maxOrNull() ?: 0, fixedSize)
            val template = StringBuilder("[")
            // 레코드 k건까지의 템플릿 길이
            val ends = ArrayList<Int>()
            ends.add(1)
            var id = 0
            while (ends[ends.size - 1] < longest - 16) {
                if (0 < id) {
                    template.append(',')
                }
                template.append(
                    "{\"id\":$id,\"name\":\"event-$id\",\"values\":[${id % 7},${id % 11},${id % 13},${id % 17},${id % 19},${id % 23}]}",
                )
                ends.add(template.length)
                id += 1
            }
            val table = if (sizes.isEmpty()) intArrayOf(fixedSize) else sizes
            val cuts =
                IntArray(table.size) { position ->
                    // ends[k] + 1 <= size - 16 을 만족하는 가장 큰 k 탐색
                    var low = 0
                    var high = ends.size - 1
                    while (low < high) {
                        val mid = (low + high + 1) / 2
                        if (ends[mid] + 1 <= table[position] - 16) {
                            low = mid
                        } else {
                            high = mid - 1
                        }
                    }
                    ends[low]
                }
            return BenchPayload(sizes, fixedSize, template.toString().toByteArray(Charsets.US_ASCII), cuts, ByteArray(longest) { 0x20 })
        }
    }
}
