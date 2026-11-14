export const MAX_SOLAR_RELIEF = 30;

// 밝은 상승 영역과 어두운 하강 경계의 변화 속도·높이는 관찰을 위해 강조한다.
export const solarConvectionShader = `
  vec4 solarCell(vec2 p,float time,out vec2 slope){
    vec2 flow=p*.015+vec2(noise(p*.028+time*.13),noise(p*.028+19.-time*.11))*.52;
    vec2 base=floor(flow),f=fract(flow),nearestDelta=vec2(0.);float nearest=3.,second=3.,phase=0.;
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
      vec2 at=vec2(float(x),float(y)),seed=base+at;
      float id=hash(seed);vec2 offset=.5+.32*sin(vec2(id,hash(seed+19.))*6.283+time*.42);
      vec2 delta=f-at-offset;float distance=length(delta);
      if(distance<nearest){second=nearest;nearest=distance;nearestDelta=delta;phase=id*6.283;}
      else second=min(second,distance);
    }
    float life=.5+.5*sin(time*1.05+phase);
    float rising=pow(max(0.,1.-nearest/.78),1.5)*(.15+.85*life);
    float lane=1.-smoothstep(.012,.10,second-nearest);
    float height=rising*28.-lane*3.+(noise(p*.07+time*.4)-.5)*2.;
    slope=nearestDelta*-1.2*(.32+.68*life);
    return vec4(height,lane,life,rising);
  }
`;
