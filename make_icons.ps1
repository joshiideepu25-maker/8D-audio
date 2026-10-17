Add-Type -AssemblyName System.Drawing

$outDir = "c:\Users\ADITYA\OneDrive\Desktop\extension for sound boost\icons"

function Draw-Icon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Dark background (full square for PNG transparency)
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 12, 8, 22))
    $g.FillEllipse($bgBrush, 0, 0, ($size - 1), ($size - 1))
    $bgBrush.Dispose()

    # Waveform bars
    $barHeights = @(0.22, 0.50, 0.78, 1.00, 0.78, 0.50, 0.22)
    $barCount   = 7
    $maxBarH    = $size * 0.56
    $barW       = [Math]::Max(1.5, $size * 0.065)
    $spacing    = ($size * 0.74) / $barCount
    $startX     = ($size / 2.0) - ($barCount / 2.0) * $spacing + $spacing * 0.1

    for ($i = 0; $i -lt $barCount; $i++) {
        $hh  = $barHeights[$i] * $maxBarH
        $x   = $startX + $i * $spacing
        $y   = ($size / 2.0) - ($hh / 2.0)
        $t   = $barHeights[$i]

        # Violet (#7C3AED) to Cyan (#06B6D4)
        $R   = [int](124 * (1 - $t) + 6   * $t)
        $G   = [int](58  * (1 - $t) + 182 * $t)
        $B   = [int](237 * (1 - $t) + 212 * $t)
        $clr = [System.Drawing.Color]::FromArgb(230, $R, $G, $B)

        $brush = New-Object System.Drawing.SolidBrush($clr)
        $g.FillRectangle($brush, [float]$x, [float]$y, [float]$barW, [float]$hh)
        $brush.Dispose()
    }

    $g.Dispose()
    return $bmp
}

@(16, 32, 48, 128) | ForEach-Object {
    $s    = $_
    $icon = Draw-Icon -size $s
    $dst  = Join-Path $outDir "icon$s.png"
    $icon.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $icon.Dispose()
    Write-Output "OK icon$s.png -> $dst"
}
Write-Output "Done."
