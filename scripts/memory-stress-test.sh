#!/bin/bash
# 内存压力测试脚本 - 发送大量请求通过代理

PROXY_PORT=8989
REQUEST_COUNT=500

echo "=== 开始发送 $REQUEST_COUNT 个请求 ==="
echo "初始内存:"
ps -o pid,rss,vsz -p $(pgrep -f 'node.*index.js') | awk 'NR>1 {print "RSS: " $2/1024 " MB"}'

# 发送请求循环
for i in $(seq 1 $REQUEST_COUNT); do
    # 通过代理发送请求到公共测试端点
    curl -s --proxy http://127.0.0.1:$PROXY_PORT \
         --connect-timeout 2 \
         --max-time 5 \
         "http://httpbin.org/get?request_id=$i" \
         > /dev/null 2>&1 || true

    # 每100个请求打印一次内存
    if [ $((i % 100)) -eq 0 ]; then
        echo "=== 请求 $i 后内存 ==="
        ps -o pid,rss,vsz -p $(pgrep -f 'node.*index.js') | awk 'NR>1 {print "RSS: " $2/1024 " MB"}'
    fi
done

echo "=== 最终内存 ==="
ps -o pid,rss,vsz -p $(pgrep -f 'node.*index.js') | awk 'NR>1 {print "RSS: " $2/1024 " MB"}'

echo "=== 等待 10 秒观察内存回收 ==="
sleep 10
ps -o pid,rss,vsz -p $(pgrep -f 'node.*index.js') | awk 'NR>1 {print "RSS: " $2/1024 " MB (after GC)"}'